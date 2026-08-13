import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { signalLabel } from "@/lib/signal-label";
import { card, eyebrow, fmtDateTime, gold } from "../../ui";
import { CopyButton } from "./copy-button";

export const metadata: Metadata = { title: "Page detail — Auramite" };
export const dynamic = "force-dynamic";

type LogLine = { text: string; danger?: boolean; ok?: boolean };
type Finding = { key?: string; severity: string; title: string; paragraph?: string; logLines?: LogLine[]; rule?: string };

/**
 * The string IT pastes into DevTools → Network → Ctrl+F to find (or, after a
 * fix, fail to find) the captured request. Pulled from the stored evidence
 * lines; host+path only — query strings vary per visit.
 */
function searchStringFrom(logLines?: LogLine[]): string | null {
  for (const l of logLines ?? []) {
    for (const raw of l.text.split(/\s+/)) {
      const tok = raw.replace(/[.,;]$/, "").replace(/…$/, "");
      if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}\/\S*$/i.test(tok)) {
        return tok.split("?")[0];
      }
    }
  }
  return null;
}

const SEV = (s: string) =>
  s === "HIGH" ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-300";

export default async function PageDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { org: { select: { id: true } } },
  });
  if (!user?.org) redirect("/login");

  const { id } = await params;
  // Scoped through the org: a forged id from another tenant is a plain 404,
  // indistinguishable from a page that never existed.
  const page = await db.page.findFirst({
    where: { id, site: { orgId: user.org.id } },
    include: { site: { select: { host: true } } },
  });
  if (!page) notFound();

  const scans = await db.scan.findMany({
    where: { pageId: page.id },
    orderBy: { ranAt: "desc" },
    take: 200,
  });

  const latestOk = scans.find((s) => s.ok);
  const latest = scans[0];
  const findings: Finding[] = Array.isArray(latestOk?.findings) ? (latestOk!.findings as Finding[]) : [];
  const highCount = findings.filter((f) => f.severity === "HIGH").length;

  const standing = !latest
    ? { label: "Not scanned yet", cls: "bg-zinc-500/15 text-zinc-400" }
    : latest && !latest.ok && latest === scans[0] && !latestOk
      ? { label: "Couldn't check", cls: "bg-zinc-500/15 text-zinc-400" }
      : highCount > 0
        ? { label: "Data leak detected", cls: "bg-red-500/15 text-red-300" }
        : findings.length > 0
          ? { label: "Possible gaps", cls: "bg-amber-500/15 text-amber-300" }
          : { label: "No leaks", cls: "bg-emerald-500/15 text-emerald-300" };

  // Same diff semantics as the dashboard and the emails: previous row even if
  // failed, missing signals → baseline.
  type Meta = { kind: "baseline" | "diff" | "error"; added: string[]; resolved: string[] };
  const meta = new Map<string, Meta>();
  {
    const asc = [...scans].sort((a, b) => a.ranAt.getTime() - b.ranAt.getTime());
    let prev: string[] | null = null;
    for (const s of asc) {
      if (!s.ok) {
        meta.set(s.id, { kind: "error", added: [], resolved: [] });
        prev = null;
        continue;
      }
      const curr = Array.isArray(s.signals) ? (s.signals as string[]) : [];
      if (prev === null) meta.set(s.id, { kind: "baseline", added: [], resolved: [] });
      else {
        const before = new Set(prev);
        const after = new Set(curr);
        meta.set(s.id, {
          kind: "diff",
          added: curr.filter((x) => !before.has(x)),
          resolved: prev.filter((x) => !after.has(x)),
        });
      }
      prev = curr;
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-12">
      <div>
        <a href="/dashboard" className="text-xs text-zinc-500 transition hover:text-zinc-300">← Dashboard</a>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 truncate text-2xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>
            {page.label || page.site.host}
          </h1>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${standing.cls}`}>{standing.label}</span>
        </div>
        <p className="mt-1 break-all font-mono text-xs text-zinc-500">{page.url}</p>
        <p className="mt-1 text-xs text-zinc-600">
          {page.cadence === "DAILY" ? "Daily" : "Weekly"} scans · {page.enabled ? "monitoring on" : "paused"} ·
          last scanned {latest ? fmtDateTime(latest.ranAt) : "never"}
        </p>
      </div>

      {/* ---- current findings, with the evidence ---- */}
      <section className="space-y-4">
        <p className={eyebrow} style={{ color: gold }}>
          Current findings {latestOk ? `— from ${fmtDateTime(latestOk.ranAt)}` : ""}
        </p>

        {!latestOk ? (
          <div className={`${card} p-6 text-sm text-zinc-500`}>
            Nothing to show yet — this page hasn&apos;t completed a scan.
          </div>
        ) : findings.length === 0 ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.07] p-6 text-sm text-emerald-200">
            No trackers fired before consent on the latest scan.
          </div>
        ) : (
          findings.map((f, i) => {
            const search = searchStringFrom(f.logLines);
            return (
              <div key={f.key ?? i} className={`${card} p-5`}>
                <div className="mb-2 flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEV(f.severity)}`}>{f.severity}</span>
                  <span className="font-medium text-white">{f.title}</span>
                </div>
                {f.paragraph && <p className="text-[15px] leading-relaxed text-zinc-300">{f.paragraph}</p>}

                {(f.logLines?.length ?? 0) > 0 && (
                  <pre className="mt-3 whitespace-pre-wrap break-all rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs leading-relaxed">
                    {f.logLines!.map((l, j) => (
                      <div key={j} className={l.danger ? "font-medium text-red-400" : l.ok ? "text-emerald-400" : "text-zinc-400"}>{l.text}</div>
                    ))}
                  </pre>
                )}

                {search && (
                  <div className="mt-3 rounded-lg border p-3" style={{ borderColor: "rgba(227,179,65,0.25)", background: "rgba(227,179,65,0.06)" }}>
                    <p className="text-xs text-zinc-400">
                      <b className="font-medium text-zinc-200">For your web team:</b> after applying a fix, open the page in Chrome →
                      <b className="text-zinc-200"> F12</b> → <b className="text-zinc-200">Network</b> → <b className="text-zinc-200">Ctrl+F</b> → paste this and reload.
                      If the request no longer appears before the consent banner, the fix worked — our next scan will confirm it and report it as fixed.
                    </p>
                    <div className="mt-2 flex items-stretch gap-2">
                      <code className="flex-1 break-all rounded border border-white/10 bg-black/40 px-2.5 py-2 font-mono text-xs" style={{ color: gold }}>{search}</code>
                      <CopyButton value={search} />
                    </div>
                  </div>
                )}

                {f.rule && (
                  <p className="mt-3 border-t border-white/10 pt-3 text-[13px] text-zinc-500">
                    <b className="font-medium text-zinc-400">The rule &amp; precedent:</b> {f.rule}
                  </p>
                )}
              </div>
            );
          })
        )}
      </section>

      {/* ---- scan history for this page ---- */}
      <section className="space-y-4">
        <p className={eyebrow} style={{ color: gold }}>Scan history</p>
        <div className={`${card} overflow-hidden`}>
          {scans.length === 0 ? (
            <p className="p-6 text-sm text-zinc-500">No scans yet — the next scheduled run will appear here.</p>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {scans.map((s) => {
                const m = meta.get(s.id)!;
                const badge = m.kind === "error"
                  ? <span className="rounded-full bg-zinc-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-400">Unreachable</span>
                  : m.kind === "baseline"
                    ? <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-400">Baseline</span>
                    : m.added.length
                      ? <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-red-300">{m.added.length} new</span>
                      : m.resolved.length
                        ? <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">{m.resolved.length} fixed</span>
                        : <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">No change</span>;
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                    <span className="w-[7.5rem] shrink-0 font-mono text-xs tabular-nums text-zinc-500">{fmtDateTime(s.ranAt)}</span>
                    {badge}
                    <span className="flex-1" />
                    <span className="text-xs text-zinc-500">{s.ok ? `${s.findingCount} finding${s.findingCount === 1 ? "" : "s"}` : (s.error ?? "failed")}</span>
                    {(m.added.length > 0 || m.resolved.length > 0) && (
                      <div className="w-full pl-[8.5rem] text-xs text-zinc-500">
                        {m.added.map((a) => <div key={`a${a}`} className="text-red-300">+ {signalLabel(a)}</div>)}
                        {m.resolved.map((a) => <div key={`r${a}`} className="text-emerald-300">− {signalLabel(a)}</div>)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
