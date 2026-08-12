import { NextResponse } from "next/server";
import { chromium } from "playwright";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const input = (body?.url || "").toString().trim();
  if (!input) return NextResponse.json({ ok: false, error: "Enter a website URL." }, { status: 400 });

  const scanner = await import("../../../../lib/scanner.mjs");
  const { buildExplainers } = await import("../../../../lib/explainers.mjs");
  const url = scanner.normalizeUrl(input);

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const scan = await scanner.scanOne(browser, url, { sendGPC: true, writeReports: false }) as Record<string, any>;
    if (scan.loadError) {
      return NextResponse.json({
        ok: false,
        unreachable: true,
        error: `We couldn't reach ${scanner.hostOf(url)} — double-check the address and try again.`,
      });
    }
    const explainers = buildExplainers(scan);
    const hard = scan.hardSaleShare || [];

    // Exact string a visitor can paste into DevTools → Network → Ctrl+F to see it fire.
    const primary = hard[0] || (scan.sessionRecorders || [])[0] || (scan.trackers || [])[0];
    let verifySearch: string | null = null;
    try {
      if (primary?.sample) { const u = new URL(primary.sample); verifySearch = u.hostname.replace(/^www\./, "") + u.pathname; }
    } catch { /* ignore */ }

    // Free-tier gate: send the FIRST finding in full; hold the rest back (only their
    // count + severity) so the locked cards can't be un-blurred from the page source.
    const shown = explainers.slice(0, 1).map((e: Record<string, unknown>) => ({
      key: e.key, severity: e.severity, title: e.title,
      paragraph: e.paragraph, logLines: e.logLines, rule: e.rule,
    }));
    const locked = explainers.slice(1).map((e: { severity: string }) => ({ severity: e.severity }));

    return NextResponse.json({
      ok: true,
      host: scanner.hostOf(url),
      url,
      verdict: scan.verdict,
      highCount: scan.highCount || 0,
      totalFindings: explainers.length,
      bannerMs: scan.bannerMs ?? null,
      firstShareMs: hard.length ? Math.min(...hard.map((t: { t?: number }) => t.t || 0)) : null,
      hardShare: hard.map((t: { name: string }) => t.name),
      cmps: (scan.cmps || []).map((c: { name: string }) => c.name),
      explainers: shown,
      locked,
      lockedCount: locked.length,
      verifySearch,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not scan that site — check the URL and try again." },
      { status: 500 },
    );
  } finally {
    if (browser) await browser.close();
  }
}
