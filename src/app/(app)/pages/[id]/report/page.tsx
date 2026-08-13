import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Compliance report — Auramite", robots: { index: false } };
export const dynamic = "force-dynamic";

type LogLine = { text: string; danger?: boolean; ok?: boolean };
type Finding = { key?: string; severity: string; title: string; paragraph?: string; logLines?: LogLine[]; rule?: string };

const fmt = (d: Date) =>
  d.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }) + " UTC";

/**
 * The hand-to-your-boss view: the latest successful scan of one page, printed
 * on white. Deliberately light-on-white even on screen — this page exists to
 * become paper (or a PDF), and previewing it dark would misrepresent it.
 */
export default async function PrintableReport({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { org: { select: { id: true, name: true } } },
  });
  if (!user?.org) redirect("/login");

  const { id } = await params;
  // Same tenancy rule as the detail view: a forged id is a plain 404.
  const page = await db.page.findFirst({
    where: { id, site: { orgId: user.org.id } },
    include: { site: { select: { host: true } } },
  });
  if (!page) notFound();

  const scan = await db.scan.findFirst({
    where: { pageId: page.id, ok: true },
    orderBy: { ranAt: "desc" },
  });

  const findings: Finding[] = Array.isArray(scan?.findings) ? (scan!.findings as Finding[]) : [];
  const high = findings.filter((f) => f.severity === "HIGH").length;
  const standing =
    !scan ? { word: "Not yet scanned", color: "#71717a" }
    : high > 0 ? { word: "Data leak detected", color: "#dc2626" }
    : findings.length > 0 ? { word: "Possible gaps", color: "#d97706" }
    : { word: "No pre-consent leaks", color: "#059669" };

  return (
    <div className="min-h-screen bg-white text-zinc-900 print:bg-white">
      <div className="mx-auto max-w-3xl px-8 py-10 print:px-0 print:py-0">
        {/* ---- screen-only toolbar ---- */}
        <div className="mb-8 flex items-center justify-between gap-4 print:hidden">
          <a href={`/pages/${page.id}`} className="text-sm text-zinc-500 hover:text-zinc-800">← Back to page detail</a>
          <PrintButton />
        </div>

        {/* ---- letterhead ---- */}
        <header className="border-b-2 border-zinc-900 pb-4">
          <div className="flex items-baseline justify-between">
            <p className="text-2xl font-bold tracking-tight">
              Auramite<span style={{ color: "#b8860b" }}>.</span>
            </p>
            <p className="text-xs uppercase tracking-widest text-zinc-500">Privacy scan report</p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            <p><span className="text-zinc-500">Page:</span> {page.label || page.site.host}</p>
            <p><span className="text-zinc-500">Prepared for:</span> {user.org.name ?? session.user.email}</p>
            <p className="break-all"><span className="text-zinc-500">URL:</span> {page.url}</p>
            <p><span className="text-zinc-500">Scan date:</span> {scan ? fmt(scan.ranAt) : "—"}</p>
          </div>
        </header>

        {/* ---- verdict ---- */}
        <section className="mt-6 rounded-[2px] border p-4" style={{ borderColor: standing.color }}>
          <p className="text-lg font-bold" style={{ color: standing.color }}>{standing.word}</p>
          <p className="mt-1 text-sm text-zinc-600">
            {scan
              ? `${high} high-severity finding${high === 1 ? "" : "s"} · ${findings.length} finding${findings.length === 1 ? "" : "s"} total on the most recent successful scan.`
              : "This page has not completed a scan yet."}
          </p>
        </section>

        {/* ---- findings ---- */}
        {findings.length > 0 && (
          <section className="mt-8 space-y-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Findings</h2>
            {findings.map((f, i) => (
              <article key={f.key ?? i} className="break-inside-avoid border-b border-zinc-200 pb-6 last:border-0">
                <div className="flex items-center gap-2">
                  <span
                    className="rounded px-2 py-0.5 text-[11px] font-bold text-white"
                    style={{ background: f.severity === "HIGH" ? "#dc2626" : "#d97706" }}
                  >
                    {f.severity}
                  </span>
                  <h3 className="font-semibold">{f.title}</h3>
                </div>
                {f.paragraph && <p className="mt-2 text-sm leading-relaxed text-zinc-700">{f.paragraph}</p>}
                {(f.logLines?.length ?? 0) > 0 && (
                  <pre className="mt-3 overflow-hidden whitespace-pre-wrap break-all rounded border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs leading-relaxed text-zinc-700">
                    {f.logLines!.map((l, j) => (
                      <div key={j} style={l.danger ? { color: "#b91c1c", fontWeight: 600 } : l.ok ? { color: "#047857" } : undefined}>
                        {l.text}
                      </div>
                    ))}
                  </pre>
                )}
                {f.rule && (
                  <p className="mt-2 text-xs text-zinc-500">
                    <b className="text-zinc-600">Rule &amp; precedent:</b> {f.rule}
                  </p>
                )}
              </article>
            ))}
          </section>
        )}

        {scan && findings.length === 0 && (
          <p className="mt-8 text-sm text-zinc-600">
            No trackers fired before consent and no compliance gaps were detected on this scan.
          </p>
        )}

        {/* ---- footer ---- */}
        <footer className="mt-10 border-t border-zinc-200 pt-4 text-xs text-zinc-400">
          <p>
            Generated by Auramite continuous compliance monitoring · auramite.io ·
            scan of {page.url} {scan ? `on ${fmt(scan.ranAt)}` : ""}
          </p>
          <p className="mt-1">
            This report records what one automated page load observed — which requests the page made, and when.
            Auramite is not a law firm; this is not legal advice and not a certification of compliance. Whether
            any observation amounts to a violation depends on facts not assessed here and is a judgement for
            counsel. A single automated load can miss controls inside a consent dialog, policies published as
            PDFs or on another domain, and content rendered only after interaction.
          </p>
        </footer>
      </div>
    </div>
  );
}
