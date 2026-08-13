import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { signalLabel } from "@/lib/signal-label";
import { card, eyebrow, fmtDateTime, gold } from "../ui";
import { TrendChart } from "./trend-chart";

export const metadata: Metadata = { title: "Dashboard — Auramite" };
export const dynamic = "force-dynamic";

const RANGES = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "all", label: "All time", days: null },
] as const;

const DAY_MS = 86_400_000;
const ROW_CAP = 1000;

type Query = { range?: string; from?: string; to?: string; sort?: string; page?: string };

/** YYYY-MM-DD in UTC, or null. `end` pushes to the last millisecond of that day. */
function parseDay(v: string | undefined, end = false): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Query> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { org: { select: { id: true } } },
  });
  if (!user?.org) redirect("/login");
  const orgId = user.org.id;

  const q = await searchParams;
  const sort: "asc" | "desc" = q.sort === "asc" ? "asc" : "desc";

  // A custom from/to overrides the preset. Invalid input is ignored rather than
  // erroring — a mistyped URL should show data, not a stack trace.
  const customFrom = parseDay(q.from);
  const customTo = parseDay(q.to, true);
  const preset = RANGES.find((r) => r.key === q.range) ?? RANGES[1];
  const usingCustom = Boolean(customFrom || customTo);
  // Reading the clock is impure, but a relative range has no other definition,
  // and this page is force-dynamic — it is rendered per request by design.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const from = usingCustom ? customFrom : preset.days ? new Date(now - preset.days * DAY_MS) : null;
  const to = usingCustom ? customTo : null;

  const pages = await db.page.findMany({
    where: { site: { orgId } },
    select: { id: true, url: true, label: true, enabled: true },
    orderBy: { createdAt: "asc" },
  });
  const pageIds = pages.map((p) => p.id);
  // Validate against this org's own pages — a forged id filters to nothing
  // rather than reaching another tenant's data.
  const pageFilter = q.page && pageIds.includes(q.page) ? q.page : null;
  const scopeIds = pageFilter ? [pageFilter] : pageIds;

  const scans = scopeIds.length
    ? await db.scan.findMany({
        where: {
          pageId: { in: scopeIds },
          ...(from || to ? { ranAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        },
        orderBy: { ranAt: "desc" },
        take: ROW_CAP,
        select: {
          id: true, pageId: true, ranAt: true, ok: true, error: true,
          verdict: true, highCount: true, findingCount: true, findings: true, signals: true,
        },
      })
    : [];
  const capped = scans.length === ROW_CAP;

  // Per page: the scan immediately BEFORE the window, so the first in-range row
  // can still be diffed; and the latest scan ever, for the status tile.
  // findFirst per page rather than Prisma `distinct` — distinct dedupes after
  // fetching, which would drag a page's whole history back for one row.
  const earliestInRange = new Map<string, Date>();
  for (const s of scans) {
    const cur = earliestInRange.get(s.pageId);
    if (!cur || s.ranAt < cur) earliestInRange.set(s.pageId, s.ranAt);
  }
  const [predecessors, latests] = await Promise.all([
    Promise.all(
      [...earliestInRange.entries()].map(async ([pageId, boundary]) => [
        pageId,
        await db.scan.findFirst({
          where: { pageId, ranAt: { lt: boundary } },
          orderBy: { ranAt: "desc" },
          select: { signals: true, ok: true, highCount: true },
        }),
      ] as const),
    ),
    Promise.all(
      pageIds.map(async (pageId) => [
        pageId,
        await db.scan.findFirst({
          where: { pageId },
          orderBy: { ranAt: "desc" },
          select: { ok: true, verdict: true, highCount: true, ranAt: true },
        }),
      ] as const),
    ),
  ]);
  const predecessorOf = new Map(predecessors);
  const latestOf = new Map(latests);

  // Diff semantics mirror monitor-core exactly, including its quirk: the
  // comparison is against the preceding scan ROW even when that row failed, so
  // a success after a failure reads as a fresh baseline. Anything else would
  // contradict the emails customers already received.
  type Meta = { kind: "baseline" | "diff" | "error"; added: string[] };
  const meta = new Map<string, Meta>();
  const byPage = new Map<string, typeof scans>();
  for (const s of scans) {
    if (!byPage.has(s.pageId)) byPage.set(s.pageId, []);
    byPage.get(s.pageId)!.push(s);
  }
  for (const [pageId, rows] of byPage) {
    const ascending = [...rows].sort((a, b) => a.ranAt.getTime() - b.ranAt.getTime());
    const seed = predecessorOf.get(pageId)?.signals;
    let prev: string[] | null = Array.isArray(seed) ? (seed as string[]) : null;
    for (const s of ascending) {
      if (!s.ok) {
        meta.set(s.id, { kind: "error", added: [] });
        prev = null;
        continue;
      }
      const curr = Array.isArray(s.signals) ? (s.signals as string[]) : [];
      if (prev === null) {
        meta.set(s.id, { kind: "baseline", added: [] });
      } else {
        const before = new Set(prev);
        meta.set(s.id, { kind: "diff", added: curr.filter((x) => !before.has(x)) });
      }
      prev = curr;
    }
  }

  const rows = sort === "asc" ? [...scans].reverse() : scans;
  const newLeakCount = [...meta.values()].reduce((n, m) => n + m.added.length, 0);
  const enabledPages = pages.filter((p) => p.enabled);
  const liveLatest = enabledPages.map((p) => latestOf.get(p.id)).filter(Boolean);
  const openHigh = liveLatest.reduce((n, l) => n + (l!.ok ? l!.highCount : 0), 0);
  const everScanned = [...latestOf.values()].some(Boolean);

  // Current standing, from each enabled page's most recent scan — deliberately
  // independent of the selected range, since "am I leaking right now" should
  // not change because someone narrowed the date filter.
  const unreachable = liveLatest.filter((l) => !l!.ok).length;
  const pagesWithHigh = liveLatest.filter((l) => l!.ok && l!.highCount > 0).length;
  const pagesWithFindings = liveLatest.filter((l) => l!.ok && l!.highCount === 0 && (l!.verdict ?? "").startsWith("POSSIBLE")).length;
  const unscanned = enabledPages.length - liveLatest.length;

  const status = !enabledPages.length || (!liveLatest.length && !everScanned)
    ? {
        tone: "none" as const,
        cls: "border-white/[0.08] bg-white/[0.02]",
        dot: "bg-zinc-500",
        text: "text-zinc-300",
        title: "Not scanned yet",
        detail: enabledPages.length ? "Your first scheduled run will set your status." : "Add pages in settings to start monitoring.",
      }
    : pagesWithHigh > 0
      ? {
          tone: "red" as const,
          cls: "border-red-500/30 bg-red-500/[0.07]",
          dot: "bg-red-500",
          text: "text-red-200",
          title: "Action needed",
          detail: `${openHigh} high-severity finding${openHigh === 1 ? "" : "s"} across ${pagesWithHigh} page${pagesWithHigh === 1 ? "" : "s"} — data is leaving before consent.`,
        }
      : pagesWithFindings > 0 || unreachable > 0 || unscanned > 0
        ? {
            tone: "amber" as const,
            cls: "border-amber-500/30 bg-amber-500/[0.07]",
            dot: "bg-amber-400",
            text: "text-amber-200",
            title: "Worth a look",
            detail: [
              pagesWithFindings > 0 && `${pagesWithFindings} page${pagesWithFindings === 1 ? "" : "s"} with lower-severity gaps`,
              unreachable > 0 && `${unreachable} page${unreachable === 1 ? "" : "s"} we couldn't reach`,
              unscanned > 0 && `${unscanned} page${unscanned === 1 ? "" : "s"} not scanned yet`,
            ].filter(Boolean).join(" · "),
          }
        : {
            tone: "green" as const,
            cls: "border-emerald-500/30 bg-emerald-500/[0.07]",
            dot: "bg-emerald-500",
            text: "text-emerald-200",
            title: "All clear",
            detail: `No trackers firing before consent on ${enabledPages.length} monitored page${enabledPages.length === 1 ? "" : "s"}.`,
          };

  const qs = (over: Partial<Query>) => {
    const p = new URLSearchParams();
    const merged: Query = { range: q.range, from: q.from, to: q.to, sort: q.sort, page: q.page, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    return `/dashboard${p.toString() ? `?${p}` : ""}`;
  };

  const rangeLabel = usingCustom
    ? `${q.from || "the beginning"} → ${q.to || "now"}`
    : preset.days
      ? `last ${preset.label}`
      : "all time";

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={eyebrow} style={{ color: gold }}>Dashboard</p>
          <h1 className="mt-2 text-2xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>
            What your pages leaked
          </h1>
          <p className="mt-1 text-sm text-zinc-500">Showing {rangeLabel}.</p>
        </div>
        <div className="flex items-center gap-1 text-[13px]">
          {RANGES.map((r) => {
            const on = !usingCustom && preset.key === r.key;
            return (
              <a
                key={r.key}
                href={qs({ range: r.key, from: undefined, to: undefined })}
                className={`rounded-lg px-3 py-1.5 transition ${on ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-200"}`}
              >
                {r.label}
              </a>
            );
          })}
        </div>
      </div>

      {/* GET form: filters live in the URL so a view can be linked or reloaded. */}
      <form method="get" className={`${card} flex flex-wrap items-end gap-3 p-4`}>
        <label className="text-xs text-zinc-500">
          From
          <input type="date" name="from" defaultValue={q.from ?? ""}
            className="mt-1 block rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-sm text-white outline-none focus:border-[#e3b341]" />
        </label>
        <label className="text-xs text-zinc-500">
          To
          <input type="date" name="to" defaultValue={q.to ?? ""}
            className="mt-1 block rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-sm text-white outline-none focus:border-[#e3b341]" />
        </label>
        <label className="text-xs text-zinc-500">
          Page
          <select name="page" defaultValue={pageFilter ?? ""}
            className="mt-1 block max-w-[16rem] rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-sm text-white outline-none focus:border-[#e3b341]">
            <option value="">All pages</option>
            {pages.map((p) => <option key={p.id} value={p.id}>{p.label || p.url}</option>)}
          </select>
        </label>
        <input type="hidden" name="sort" value={sort} />
        <button type="submit" className="rounded-lg px-4 py-1.5 text-sm font-semibold text-[#0b0a08] transition hover:brightness-110" style={{ background: gold }}>
          Apply
        </button>
        {(usingCustom || pageFilter) && (
          <a href="/dashboard" className="text-xs text-zinc-500 transition hover:text-zinc-300">Clear</a>
        )}
      </form>

      {/* Current standing, before any of the range-dependent numbers. */}
      <div className={`rounded-2xl border p-5 ${status.cls}`} role="status">
        <div className="flex items-center gap-3">
          <span className={`h-3 w-3 shrink-0 rounded-full ${status.dot}`} aria-hidden />
          <div className="min-w-0">
            <p className={`font-semibold ${status.text}`}>{status.title}</p>
            <p className="mt-0.5 text-sm text-zinc-400">{status.detail}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Pages monitored", value: `${enabledPages.length}${pages.length !== enabledPages.length ? ` / ${pages.length}` : ""}` },
          { label: "Scans in range", value: String(scans.length) },
          { label: "New leaks in range", value: String(newLeakCount), hot: newLeakCount > 0 },
          { label: "Open high findings", value: String(openHigh), hot: openHigh > 0 },
        ].map((t) => (
          <div key={t.label} className={`${card} p-5`}>
            <p className="font-mono text-[11px] text-zinc-500">{t.label}</p>
            <p className="mt-2 text-3xl font-bold" style={{ fontFamily: "var(--font-display)", color: t.hot ? "#fca5a5" : "#fff" }}>
              {t.value}
            </p>
          </div>
        ))}
      </div>

      <TrendChart
        scans={scans}
        addedOf={(id) => meta.get(id)?.added.length ?? 0}
        predecessorOf={predecessorOf}
        from={from}
        to={to}
      />

      {pages.length === 0 ? (
        <div className={`${card} p-8 text-center`}>
          <p className="font-medium text-white">No pages under watch yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">
            Add the pages that matter most — your homepage, top landing pages, and checkout — and we&apos;ll scan them on your plan&apos;s schedule.
          </p>
          <a href="/settings" className="mt-5 inline-block rounded-lg px-5 py-2.5 text-sm font-semibold text-[#0b0a08] transition hover:brightness-110" style={{ background: gold }}>
            Choose pages to watch
          </a>
        </div>
      ) : !everScanned ? (
        <div className={`${card} p-8 text-center`}>
          <p className="font-medium text-white">Nothing scanned yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">
            Your first scheduled run will appear here, and the report goes to your recipients at the same time.
          </p>
        </div>
      ) : scans.length === 0 ? (
        <div className={`${card} p-8 text-center`}>
          <p className="font-medium text-white">No scans in this range</p>
          <p className="mt-2 text-sm text-zinc-500">Try a wider range, or clear the filters.</p>
        </div>
      ) : (
        <div className={`${card} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Scan history</p>
            <a href={qs({ sort: sort === "desc" ? "asc" : "desc" })} className="text-xs text-zinc-500 transition hover:text-zinc-200">
              {sort === "desc" ? "Newest first ↓" : "Oldest first ↑"}
            </a>
          </div>

          <ul className="divide-y divide-white/[0.06]">
            {rows.map((s) => {
              const m = meta.get(s.id) ?? { kind: "baseline" as const, added: [] };
              const page = pages.find((p) => p.id === s.pageId);
              const findings = Array.isArray(s.findings) ? (s.findings as { severity?: string; title?: string }[]) : [];
              const expandable = m.added.length > 0 || findings.length > 0;

              const badge = m.kind === "error"
                ? <span className="rounded-full bg-zinc-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-400">Unreachable</span>
                : m.kind === "baseline"
                  ? <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-400">Baseline</span>
                  : m.added.length
                    ? <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-red-300">{m.added.length} new</span>
                    : <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">No change</span>;

              const body = (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
                  <span className="w-[7.5rem] shrink-0 font-mono text-xs tabular-nums text-zinc-500">{fmtDateTime(s.ranAt)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {page ? (
                      // New window on purpose — the reader keeps their place in the history.
                      <a
                        href={`/pages/${page.id}`}
                        target="_blank"
                        rel="noopener"
                        className="text-zinc-200 underline decoration-white/20 underline-offset-4 transition hover:text-white hover:decoration-[#e3b341]"
                      >
                        {page.label || page.url}
                      </a>
                    ) : (
                      <span className="text-zinc-200">—</span>
                    )}
                  </span>
                  {badge}
                  <span className="w-24 shrink-0 text-right text-xs text-zinc-500">
                    {s.ok ? `${s.findingCount} finding${s.findingCount === 1 ? "" : "s"}` : "failed"}
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs">
                    {s.ok && s.highCount > 0 ? <span className="text-red-300">{s.highCount} high</span> : <span className="text-zinc-600">—</span>}
                  </span>
                </div>
              );

              return (
                <li key={s.id}>
                  {expandable ? (
                    <details className="group">
                      <summary className="cursor-pointer list-none transition hover:bg-white/[0.02]">{body}</summary>
                      <div className="space-y-3 border-t border-white/[0.06] bg-black/20 px-5 py-4 pl-[8.5rem]">
                        {m.added.length > 0 && (
                          <div>
                            <p className="font-mono text-[11px] uppercase tracking-wide text-red-300">New since the previous scan</p>
                            <ul className="mt-1.5 space-y-1 text-sm text-zinc-300">
                              {m.added.map((a) => <li key={a}>{signalLabel(a)}</li>)}
                            </ul>
                          </div>
                        )}
                        {findings.length > 0 && (
                          <div>
                            <p className="font-mono text-[11px] uppercase tracking-wide text-zinc-500">Findings on this scan</p>
                            <ul className="mt-1.5 space-y-1 text-sm text-zinc-400">
                              {findings.map((f, i) => (
                                <li key={i}>
                                  <span className={f.severity === "HIGH" ? "text-red-300" : "text-amber-300"}>[{f.severity}]</span> {f.title}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </details>
                  ) : (
                    <div>
                      {body}
                      {!s.ok && s.error && <p className="px-5 pb-3 pl-[8.5rem] text-xs text-zinc-600">{s.error}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {capped && (
            <p className="border-t border-white/[0.08] px-5 py-3 text-xs text-zinc-500">
              Showing the most recent {ROW_CAP} scans in this range. Narrow the range or filter to a page to see the rest.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
