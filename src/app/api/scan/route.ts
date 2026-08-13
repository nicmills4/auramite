import { NextResponse } from "next/server";
import { chromium } from "playwright";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import type { ScanData, TrackerHit } from "@/lib/scan-types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  // Each scan holds a Chromium instance for ~25s — a handful per hour per
  // visitor is generous; more is a bot burning our CPU.
  const rl = rateLimit(`scan:${await clientIp()}`, 6, 3600e3);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many scans from your network — try again in a little while." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let body: { url?: string; authorized?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const input = (body?.url || "").toString().trim();
  if (!input) return NextResponse.json({ ok: false, error: "Enter a website URL." }, { status: 400 });

  // Checked server-side, not just in the form: the point is that no scan runs
  // without an affirmative statement of authority, and a client-side checkbox
  // is trivially skipped by anyone posting straight to this endpoint.
  if (body?.authorized !== true) {
    return NextResponse.json(
      { ok: false, error: "Confirm you own this site or are authorized to scan it." },
      { status: 400 },
    );
  }

  const scanner = await import("../../../../lib/scanner.mjs");
  const { buildExplainers } = await import("../../../../lib/explainers.mjs");
  const url = scanner.normalizeUrl(input);

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const scan = await scanner.scanOne(browser, url, { sendGPC: true, writeReports: false }) as ScanData;
    if (scan.loadError) {
      return NextResponse.json({
        ok: false,
        unreachable: true,
        error: `We couldn't reach ${scanner.hostOf(url)} — double-check the address and try again.`,
      });
    }
    const explainers = buildExplainers(scan);
    const hard = scan.hardSaleShare || [];

    // Single source of truth for what the free tier may name. Hard sale/share vendors
    // are already stated in the first finding; session recorders only when that IS the
    // shown finding. Everything else stays anonymous — including in verifySearch, which
    // would otherwise name a locked vendor through its request URL.
    const disclosed = new Set<string>(hard.map((t: { name: string }) => t.name));
    if (explainers[0]?.key === "session-replay") {
      for (const r of scan.sessionRecorders || []) disclosed.add(r.name);
    }

    // Exact string a visitor can paste into DevTools → Network → Ctrl+F to see it fire.
    const primary = (scan.trackers || []).find((t) => disclosed.has(t.name) && t.sample);
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

    // ---- Timeline events, gated server-side with the same disclosure rule ----
    // Names appear only for trackers the free tier already reveals (hard sale/share,
    // plus session recorders when that is the shown finding). Everything else fires
    // as an anonymous event: real timestamp, no vendor.
    type Ev = { t: number; kind: string; label: string; detail?: string; tag?: string };
    const fmtT = (ms: number) => (ms / 1000).toFixed(2) + "s";
    const short = (u?: string) => {
      try { const x = new URL(u ?? ""); const s = x.hostname.replace(/^www\./, "") + x.pathname; return s.length > 64 ? s.slice(0, 64) + "…" : s; }
      catch { return ""; }
    };

    const events: Ev[] = [{ t: 0, kind: "visit", label: "A visitor lands on your homepage" }];
    if (scan.sentGPC) {
      events.push({
        t: 0, kind: "signal",
        label: "Their browser asks not to be tracked",
        detail: "Sec-GPC: 1 — the Global Privacy Control opt-out signal state laws require sites to honor",
      });
    }

    const fired = (scan.trackers || [])
      .filter((t): t is TrackerHit & { t: number } => typeof t.t === "number")
      .sort((a, b) => a.t - b.t);
    const named = fired.filter((t) => disclosed.has(t.name)).slice(0, 5);
    const anon = fired.filter((t) => !named.includes(t));

    for (const t of named) {
      events.push({
        t: t.t, kind: "leak",
        label: t.category === "session-recording" ? `${t.name} begins recording the visit` : `${t.name} receives visitor data`,
        detail: `${t.method || "GET"}  ${short(t.sample)}`,
        tag: t.category === "session-recording" ? "Session recording" : "Sale/share",
      });
    }

    const SHOWN_ANON = 5;
    for (const t of anon.slice(0, SHOWN_ANON)) {
      events.push({ t: t.t, kind: "locked", label: "Another tracker fires", detail: "Vendor identified — shown in your full report" });
    }
    // The remainder collapses into one row. It carries the LAST of their timestamps so
    // it never sorts above the banner while representing a tracker that fired after it —
    // the banner's "everything above happened first" line has to stay literally true.
    const restCount = anon.length - SHOWN_ANON;
    if (restCount > 0) {
      const rest = anon.slice(SHOWN_ANON);
      const firstT = rest[0].t;
      const lastT = rest[rest.length - 1].t;
      events.push({
        t: lastT, kind: "locked",
        label: `${restCount} more tracker${restCount === 1 ? "" : "s"} fire${restCount === 1 ? "s" : ""}`,
        detail: firstT === lastT
          ? "All identified — shown in your full report"
          : `Between ${fmtT(firstT)} and ${fmtT(lastT)} — all identified in your full report`,
      });
    }

    const bannerMs = scan.bannerMs;
    if (bannerMs != null) {
      const cmpName = (scan.cmps || [])[0]?.name;
      const leaksBefore = events.some((e) => (e.kind === "leak" || e.kind === "locked") && e.t < bannerMs);
      events.push({
        t: bannerMs, kind: "banner",
        label: `${cmpName ? `${cmpName} consent banner` : "The consent banner"} appears`,
        detail: leaksBefore ? "Everything above happened before anyone could say no" : undefined,
      });
    }
    events.sort((a, b) => a.t - b.t);
    if (!events.some((e) => e.kind === "leak" || e.kind === "locked")) {
      events.push({ t: Math.max(...events.map((e) => e.t)), kind: "clear", label: "No pre-consent tracker fires detected" });
    }

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
      events,
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
