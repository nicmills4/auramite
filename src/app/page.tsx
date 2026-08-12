"use client";

import { useEffect, useState } from "react";

type LogLine = { text: string; danger?: boolean; ok?: boolean };
type Explainer = { key: string; severity: "HIGH" | "MEDIUM"; title: string; paragraph: string; logLines: LogLine[]; rule: string };
type ScanResult = {
  ok: boolean; host: string; url: string; verdict: string; highCount: number;
  totalFindings: number; bannerMs: number | null; firstShareMs: number | null;
  hardShare: string[]; cmps: string[]; explainers: Explainer[];
  locked: { severity: "HIGH" | "MEDIUM" }[]; lockedCount: number; verifySearch: string | null; error?: string;
};

const fmtT = (ms: number | null) => (ms == null ? "?" : (ms / 1000).toFixed(2) + "s");
const gold = "#e3b341";
// Set to your Calendly (or other booking) URL to enable direct booking in the modal.
const CALENDLY_URL = "";

const card = "rounded-2xl border border-white/[0.08] bg-white/[0.02]";
const eyebrow = "font-mono text-[11px] uppercase tracking-[0.2em]";

const BENTO = [
  { n: "01", k: "Probe", h: "We find the gaps first", p: "Headless Chrome opens your site cold — no cookies, no history — and records every request that fires before anyone touches your consent banner." },
  { n: "02", k: "Prove", h: "Evidence, not opinions", p: "You get the exact request URLs and their timestamps, so you can reproduce every finding yourself in DevTools in about thirty seconds." },
  { n: "03", k: "Reinforce", h: "Close each gap, vendor by vendor", p: "Which tags to gate behind consent, which need consent-mode wired up, and what to change in your tag manager to do it." },
  { n: "04", k: "Stand watch", h: "It stays sealed", p: "We re-scan on a schedule and email you the moment a new tag slips back in — which is usually how sites regress after a marketing hire." },
];

const CHECKS = [
  ["Ad pixels firing before consent", "Meta, Google, LinkedIn & TikTok tags that share visitor IDs on page load — a CCPA/CPRA “sale/share.”"],
  ["Ignored “Do Not Track” (GPC) signals", "State laws require honoring the browser opt-out signal automatically. Most sites don’t."],
  ["Session recording (CIPA)", "Hotjar/FullStory/Clarity capturing what visitors type — the #1 “wiretapping” lawsuit issue of 2025."],
  ["Video + Meta Pixel (VPPA)", "Tells Facebook which videos a visitor watched — a fast-growing class-action wave."],
  ["A cookie banner that doesn’t block", "Termly/CookieYes installed but not gating anything — the Tractor Supply $1.35M pattern."],
  ["Missing “Your Privacy Choices” opt-out", "Required for any business that sells or shares data."],
];

const TIERS = [
  { name: "Free scan", price: "$0", per: "", tag: "Find out where you stand", hot: false, feats: ["One-time homepage scan", "Your first finding, in full", "Self-verify instructions"] },
  { name: "Starter", price: "$99", per: "/mo", tag: "Stay compliant", hot: true, feats: ["1 site, key pages", "Weekly re-scans + alerts", "Step-by-step fix guide", "Email reports"] },
  { name: "Growth", price: "$299", per: "/mo", tag: "Multi-site & faster", hot: false, feats: ["Up to 5 sites", "Daily scans + GPC checks", "Consent-mode setup guidance", "Priority support"] },
];

// Indicative pacing for the wait UI — these are the scanner's real phases in
// order, on an estimated clock (the API returns one response, not progress events).
const SCAN_BUDGET = 30;
const SCAN_STAGES: [number, string][] = [
  [0, "Opening your homepage in a clean browser"],
  [4, "Recording every network request"],
  [9, "Waiting for your consent banner to appear"],
  [16, "Classifying trackers and their vendors"],
  [23, "Checking Global Privacy Control signals"],
];

const Check = () => (
  <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden>
    <path d="M4 10.5l4 4 8-9" stroke="#e3b341" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");
  const [showConsult, setShowConsult] = useState(false);
  const [consultEmail, setConsultEmail] = useState("");
  const [consultSent, setConsultSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [waitEmail, setWaitEmail] = useState("");
  const [waitEmailSent, setWaitEmailSent] = useState(false);
  const [showWaitEmail, setShowWaitEmail] = useState(false);

  // Drives the countdown and stage list while a scan is in flight.
  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const startedAt = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => clearInterval(id);
  }, [loading]);

  // Reveal [data-reveal] blocks as they scroll in. Re-runs when results swap the
  // page content out, so freshly mounted nodes get observed too.
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-visible)");
    if (!els.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [result]);

  async function runScan(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true); setError(""); setResult(null);
    setShowWaitEmail(false); setWaitEmailSent(false); setWaitEmail("");
    try {
      const res = await fetch("/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const data = await res.json();
      if (!data.ok) setError(data.error || "Scan failed.");
      else setResult(data);
    } catch { setError("Something went wrong. Try again."); }
    finally { setLoading(false); }
  }

  function openConsult() { setConsultSent(false); setShowConsult(true); }

  // Hands the scan off to the server, which runs its own and emails the report —
  // so it still lands if this tab is closed.
  async function submitWaitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!waitEmail.trim()) return;
    setWaitEmailSent(true);
    try {
      await fetch("/api/scan-email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: waitEmail, url }) });
    } catch { /* the report is already queued server-side on success; nothing useful to show here */ }
  }

  function copyVerify() {
    if (!result?.verifySearch) return;
    navigator.clipboard?.writeText(result.verifySearch);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function submitConsult(e: React.FormEvent) {
    e.preventDefault();
    if (!consultEmail.trim()) return;
    try {
      await fetch("/api/lead", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: consultEmail, url: result?.url, intent: "consultation" }) });
    } catch { /* ignore */ }
    setConsultSent(true);
  }

  const leaked = result && result.highCount > 0;
  const sevChip = (s: string) => s === "HIGH" ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-300";

  const secs = elapsed / 1000;
  const remaining = Math.max(0, SCAN_BUDGET - Math.floor(secs));
  const overtime = secs >= SCAN_BUDGET;
  const stageIdx = SCAN_STAGES.reduce((acc, [at], i) => (secs >= at ? i : acc), 0);
  const RING = 2 * Math.PI * 34;

  return (
    <main className="flex-1 text-zinc-300">
      {/* ---------- nav ---------- */}
      <nav className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#0b0a08]/80 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <a href="/" className="flex items-center gap-1.5">
            <span className="text-lg font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>Auramite</span>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: gold }} />
          </a>
          <div className="flex items-center gap-5 sm:gap-8 text-[13px] text-zinc-500">
            <a href="#how" className="hidden sm:inline hover:text-zinc-200 transition-colors">How it works</a>
            <a href="#checks" className="hidden sm:inline hover:text-zinc-200 transition-colors">What we check</a>
            <a href="#pricing" className="hidden sm:inline hover:text-zinc-200 transition-colors">Pricing</a>
            <a href="#scan" className="hover:text-zinc-200 transition-colors">Scan</a>
          </div>
        </div>
      </nav>

      {/* ---------- hero ---------- */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="fade-in pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[420px] w-[900px] rounded-full" style={{ background: "radial-gradient(closest-side, rgba(227,179,65,0.14), transparent)" }} />
        <div aria-hidden className="fade-in pointer-events-none select-none absolute inset-0 flex items-center justify-center" style={{ animationDelay: "160ms" }}>
          <span className="watermark font-bold tracking-tighter whitespace-nowrap" style={{ fontFamily: "var(--font-display)", fontSize: "26vw", lineHeight: 1 }}>AURAMITE</span>
        </div>

        <div className="relative z-10 mx-auto max-w-3xl px-6 pt-20 pb-16 text-center">
          <p className={`${eyebrow} fade-up mb-6`} style={{ color: gold }}>Pre-consent defense &amp; monitoring</p>
          <h1 className="fade-up text-4xl sm:text-5xl font-bold tracking-tight leading-[1.05]" style={{ fontFamily: "var(--font-display)", color: gold, animationDelay: "70ms" }}>Enlist Auramite to watch your site like an eagle.</h1>
          <p className="fade-up mt-5 text-[17px] leading-relaxed text-zinc-400 max-w-2xl mx-auto" style={{ animationDelay: "140ms" }}>
            <span className="text-zinc-100 font-medium">Armor your site against consumer data leaks.</span> We load
            it as a real visitor, catch every tracker that hands personal data to advertisers before anyone
            consents, and show you how to shut it down — then stand watch so it stays shut.
          </p>

          <form id="scan" onSubmit={runScan} className="fade-up mt-9 flex flex-col sm:flex-row gap-2.5 max-w-xl mx-auto scroll-mt-24" style={{ animationDelay: "210ms" }}>
            <input
              value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="yourcompany.com" inputMode="url"
              className="flex-1 rounded-lg bg-white/[0.04] border border-white/15 px-4 py-3 text-white placeholder:text-zinc-500 outline-none focus:border-[#e3b341] focus:ring-2 focus:ring-[#e3b341]/25 transition"
            />
            <button type="submit" disabled={loading}
              className="rounded-lg px-7 py-3 font-semibold text-[#0b0a08] transition hover:brightness-110 disabled:opacity-60"
              style={{ background: gold }}>
              {loading ? (
                <span className="flex items-center gap-2"><span className="inline-block h-4 w-4 rounded-full border-2 border-[#0b0a08]/40 border-t-[#0b0a08] animate-spin" />Scanning…</span>
              ) : "Scan my site"}
            </button>
          </form>
          <p className="fade-up mt-3 text-xs text-zinc-600" style={{ animationDelay: "280ms" }}>No signup · results in ~20 seconds · plain-English findings, not legal advice</p>

          {error && (
            <div className="mt-5 mx-auto max-w-xl rounded-lg border border-red-500/30 bg-red-500/[0.08] px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
          {loading && (
            <div className={`${card} mt-6 mx-auto max-w-md p-6 text-left`} role="status" aria-live="polite">
              <div className="flex items-center gap-5">
                <div className="relative shrink-0">
                  <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90" aria-hidden>
                    <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
                    <circle
                      cx="40" cy="40" r="34" fill="none" stroke={gold} strokeWidth="5" strokeLinecap="round"
                      strokeDasharray={RING}
                      strokeDashoffset={RING * (1 - Math.min(secs / SCAN_BUDGET, 1))}
                      style={{ transition: "stroke-dashoffset 0.15s linear" }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    {overtime ? (
                      <span className="inline-block h-5 w-5 rounded-full border-2 border-zinc-700 border-t-[#e3b341] animate-spin" />
                    ) : (
                      <span className="text-2xl font-bold tabular-nums text-white" style={{ fontFamily: "var(--font-display)" }}>{remaining}</span>
                    )}
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-white">{overtime ? "Almost there…" : "Scanning your site"}</p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {overtime
                      ? "This one is taking a little longer than usual. Hang tight — we won't drop it."
                      : `About ${remaining} second${remaining === 1 ? "" : "s"} left.`}
                  </p>
                </div>
              </div>

              <ul className="mt-5 space-y-2 border-t border-white/[0.08] pt-4 text-sm">
                {SCAN_STAGES.map(([, label], i) => {
                  const done = i < stageIdx || overtime;
                  const active = i === stageIdx && !overtime;
                  return (
                    <li key={label} className={`flex items-center gap-2.5 transition-colors ${done ? "text-zinc-500" : active ? "text-zinc-200" : "text-zinc-700"}`}>
                      {done ? (
                        <Check />
                      ) : active ? (
                        <span className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-zinc-700 border-t-[#e3b341] animate-spin" />
                      ) : (
                        <span className="h-4 w-4 shrink-0" />
                      )}
                      <span className="truncate">{label}</span>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-4 border-t border-white/[0.08] pt-4">
                {waitEmailSent ? (
                  <p className="text-sm" style={{ color: gold }}>
                    Done — we&apos;ll email your report to <span className="font-medium">{waitEmail}</span> when the scan finishes. You can close this tab.
                  </p>
                ) : showWaitEmail ? (
                  <form onSubmit={submitWaitEmail} className="flex gap-2">
                    <input
                      type="email" required autoFocus value={waitEmail} onChange={(e) => setWaitEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="min-w-0 flex-1 rounded-lg bg-white/[0.05] border border-white/15 px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-[#e3b341]"
                    />
                    <button type="submit" className="shrink-0 rounded-lg px-3.5 py-2 text-sm font-semibold text-[#0b0a08] transition hover:brightness-110" style={{ background: gold }}>
                      Email it
                    </button>
                  </form>
                ) : (
                  <p className="text-xs text-zinc-600">
                    Keep this tab open — results appear here the moment we&apos;re done. Or{" "}
                    <button type="button" onClick={() => setShowWaitEmail(true)} className="font-medium underline underline-offset-2 hover:brightness-110" style={{ color: gold }}>
                      email me the results instead
                    </button>
                    .
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ---------- results ---------- */}
      {result && (
        <section className="mx-auto max-w-6xl px-6 pt-12 pb-16">
          <div className="grid gap-4 items-start md:grid-cols-2 lg:grid-cols-3">

            {/* col 1: summary + timeline + verify */}
            <div className="space-y-4">
              <div className={`rounded-2xl border p-5 ${leaked ? "border-red-500/30 bg-red-500/[0.07]" : "border-emerald-500/30 bg-emerald-500/[0.07]"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white">{result.host}</span>
                  <span className={`text-xs font-semibold rounded-full px-3 py-1 ${leaked ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"}`}>
                    {leaked ? "DATA LEAK DETECTED" : "NO OBVIOUS LEAK"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-zinc-400">{result.verdict}</p>
                {leaked && result.totalFindings > 1 && (
                  <p className="mt-2 text-sm" style={{ color: gold }}>We found {result.totalFindings} issues. Here&apos;s the first — the rest are one click away.</p>
                )}
              </div>

              {result.firstShareMs != null && (
                <div className={`${card} p-5`}>
                  {/* Rows land in sequence so the order of events reads as a story. */}
                  <div className="grid grid-cols-[56px_1fr] gap-y-3 text-sm">
                    <div className="fade-up font-medium text-zinc-500">0.00s</div>
                    <div className="fade-up flex gap-2 text-zinc-200"><span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />A visitor opens your homepage.</div>
                    <div className="fade-up font-medium text-red-400" style={{ animationDelay: "320ms" }}>{fmtT(result.firstShareMs)}</div>
                    <div className="fade-up flex gap-2 text-zinc-200" style={{ animationDelay: "320ms" }}><span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-red-500 shrink-0" /><span><b className="font-medium text-white">Data already sent to {result.hardShare.join(", ") || "advertisers"}.</b> No one was asked.</span></div>
                    {result.bannerMs != null && (
                      <>
                        <div className="fade-up font-medium text-zinc-500" style={{ animationDelay: "700ms" }}>{fmtT(result.bannerMs)}</div>
                        <div className="fade-up flex gap-2 text-zinc-400" style={{ animationDelay: "700ms" }}><span className="mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-zinc-500 shrink-0" />Your cookie banner appears — after the data already left.</div>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="rounded-2xl border p-5 text-sm text-zinc-300" style={{ borderColor: "rgba(227,179,65,0.25)", background: "rgba(227,179,65,0.06)" }}>
                <b className="font-medium text-white">Don&apos;t take our word for it.</b>
                <p className="mt-2 text-zinc-400">Open your site in Chrome → press <b className="text-zinc-200">F12</b> → <b className="text-zinc-200">Network</b> tab → <b className="text-zinc-200">Ctrl+F</b> → paste this:</p>
                {result.verifySearch && (
                  <div className="mt-2 flex items-stretch gap-2">
                    <code className="flex-1 break-all rounded bg-black/40 border border-white/10 px-2.5 py-2 text-xs font-mono" style={{ color: gold }}>{result.verifySearch}</code>
                    <button onClick={copyVerify} className="shrink-0 rounded bg-white/10 hover:bg-white/20 px-3 text-xs font-medium text-white transition">{copied ? "Copied!" : "Copy"}</button>
                  </div>
                )}
                <p className="mt-2 text-xs text-zinc-500">That exact request fires <b className="text-zinc-400">before</b> your consent banner. Or check <span className="font-mono" style={{ color: gold }}>blacklight.themarkup.org</span>.</p>
              </div>
            </div>

            {/* col 2: the open finding */}
            <div className="space-y-4">
              {result.explainers.map((ex) => (
                <div key={ex.key} className={`${card} p-5`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-semibold rounded-full px-2.5 py-0.5 ${sevChip(ex.severity)}`}>{ex.severity}</span>
                    <span className="font-medium text-white">{ex.title}</span>
                  </div>
                  <p className="text-[15px] text-zinc-300 leading-relaxed">{ex.paragraph}</p>
                  {ex.logLines?.length > 0 && (
                    <pre className="mt-3 whitespace-pre-wrap break-all rounded-lg bg-black/40 border border-white/10 p-3 text-xs leading-relaxed font-mono text-zinc-400">
                      {ex.logLines.map((l, i) => (
                        <div key={i} className={l.danger ? "text-red-400 font-medium" : l.ok ? "text-emerald-400" : "text-zinc-400"}>{l.text}</div>
                      ))}
                    </pre>
                  )}
                  <p className="mt-3 pt-3 border-t border-white/10 text-[13px] text-zinc-500"><b className="font-medium text-zinc-400">The rule &amp; precedent:</b> {ex.rule}</p>
                </div>
              ))}
            </div>

            {/* col 3: locked panel */}
            {result.lockedCount > 0 ? (
              <div className={`${card} p-5`}>
                <p className="font-medium text-white">{result.lockedCount} more finding{result.lockedCount > 1 ? "s" : ""}</p>
                <p className="text-xs text-zinc-500 mb-4">Hidden on the free scan.</p>
                <div className="space-y-2.5">
                  {result.locked.map((lk, i) => (
                    <div key={`lk${i}`} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-xs font-semibold rounded-full px-2.5 py-0.5 ${sevChip(lk.severity)}`}>{lk.severity}</span>
                        <span className="text-xs text-zinc-500">Finding {i + 2} of {result.totalFindings}</span>
                      </div>
                      <div className="space-y-1.5 blur-[3px] select-none pointer-events-none" aria-hidden>
                        <div className="h-2 rounded bg-white/10 w-2/3" />
                        <div className="h-2 rounded bg-white/10 w-full" />
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={openConsult} className="mt-5 w-full rounded-lg py-2.5 font-semibold text-[#0b0a08] hover:brightness-110" style={{ background: gold }}>
                  Schedule a consultation to view {result.lockedCount} more →
                </button>
              </div>
            ) : leaked ? (
              <div className="rounded-2xl border p-5 text-center" style={{ borderColor: "rgba(227,179,65,0.4)", background: "rgba(227,179,65,0.08)" }}>
                <p className="font-semibold text-white">Get {result.host} fixed</p>
                <p className="text-sm text-zinc-400 mt-1 mb-4">Book a free 15-minute consultation — we&apos;ll walk you through the finding, with the proof, and how to fix it.</p>
                <button onClick={openConsult} className="w-full rounded-lg py-2.5 font-semibold text-[#0b0a08] hover:brightness-110" style={{ background: gold }}>Schedule my consultation →</button>
              </div>
            ) : null}

          </div>
        </section>
      )}

      {/* ---------- consultation modal ---------- */}
      {showConsult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowConsult(false)}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#141210] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowConsult(false)} className="absolute top-4 right-4 text-zinc-500 hover:text-white text-lg">✕</button>
            {consultSent ? (
              <div className="text-center py-4">
                <p className="text-white font-semibold text-lg">Request received</p>
                <p className="text-zinc-400 mt-2 text-sm">We&apos;ll email you shortly to lock in a 15-minute consultation and walk you through every finding on {result?.host}.</p>
              </div>
            ) : (
              <>
                <h3 className="text-xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>See everything we found</h3>
                <p className="text-sm text-zinc-400 mt-2">
                  {result ? <>Your site has <span className="text-white font-medium">{result.totalFindings} issue{result.totalFindings > 1 ? "s" : ""}</span> — we&apos;ve shown you one. </> : null}
                  Book a free 15-minute consultation and we&apos;ll walk through all of them, with the proof, and exactly how to fix each.
                </p>
                <form onSubmit={submitConsult} className="mt-4 space-y-2">
                  <input type="email" required value={consultEmail} onChange={(e) => setConsultEmail(e.target.value)} placeholder="you@company.com"
                    className="w-full rounded-lg bg-white/[0.05] border border-white/15 px-4 py-2.5 text-white placeholder:text-zinc-500 outline-none focus:border-[#e3b341]" />
                  <button className="w-full rounded-lg py-2.5 font-semibold text-[#0b0a08] hover:brightness-110" style={{ background: gold }}>Request my consultation</button>
                </form>
                {CALENDLY_URL && <a href={CALENDLY_URL} target="_blank" rel="noreferrer" className="block text-center text-sm mt-3" style={{ color: gold }}>Or grab a time directly →</a>}
                <p className="text-[11px] text-zinc-600 mt-3 text-center">No spam. We&apos;ll only use your email to schedule.</p>
              </>
            )}
          </div>
        </div>
      )}

      {!result && (
        <>
          {/* ---------- evidence pairing ---------- */}
          <section className="mx-auto max-w-6xl px-6 py-20">
            <div data-reveal className="text-center mb-10">
              <p className={`${eyebrow} mb-3`} style={{ color: gold }}>What you get back</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>See the gap, then seal it.</h2>
            </div>
            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr] items-stretch">
              <div data-reveal style={{ transitionDelay: "80ms" }} className={`${card} overflow-hidden`}>
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.08] font-mono text-[11px] text-zinc-500">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  Network · fired before the consent banner
                  <span className="ml-auto rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] tracking-wide text-zinc-500">EXAMPLE</span>
                </div>
                <pre className="whitespace-pre-wrap break-all p-4 font-mono text-[12px] leading-[2] text-zinc-500">
                  <div><span className="text-red-400 font-medium">GET</span>  snap.licdn.com/li.lms-analytics/insight.min.js</div>
                  <div><span className="text-red-400 font-medium">GET</span>  www.google-analytics.com/g/collect?v=2&amp;tid=G-XXXX</div>
                  <div><span className="text-red-400 font-medium">POST</span> px.ads.linkedin.com/collect</div>
                  <div className="text-zinc-600">— consent banner rendered at 7.21s —</div>
                </pre>
              </div>
              <div data-reveal style={{ transitionDelay: "180ms" }} className={`${card} p-5 flex flex-col`}>
                <p className="font-mono text-[11px] text-zinc-500 mb-4">VERDICT</p>
                <p className="text-3xl font-bold leading-none" style={{ fontFamily: "var(--font-display)", color: gold }}>3 trackers</p>
                <p className="text-sm text-zinc-500 mt-1.5 mb-5">fired before anyone consented</p>
                <div className="space-y-2">
                  {[["LinkedIn Insight Tag", "Sale/share", "text-red-300"], ["Google Analytics 4", "Gray area", "text-amber-300"]].map(([n, v, c]) => (
                    <div key={n} className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[13px]">
                      <span className="text-zinc-300">{n}</span><span className={c}>{v}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between rounded-lg border border-white/[0.05] bg-white/[0.01] px-3 py-2 text-[13px] text-zinc-600">
                    <span>1 more finding</span><span>Locked</span>
                  </div>
                </div>
                <p className="mt-auto pt-5 text-xs text-zinc-600">Your scan shows your own site&apos;s real captured requests.</p>
              </div>
            </div>
          </section>

          {/* ---------- bento ---------- */}
          <section id="how" className="scroll-mt-16">
            <div className="mx-auto max-w-6xl px-6 py-20">
              <div data-reveal className="text-center mb-10">
                <p className={`${eyebrow} mb-3`} style={{ color: gold }}>How it works</p>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>Four layers of cover.</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {BENTO.map((b, i) => (
                  <div key={b.n} data-reveal style={{ transitionDelay: `${i * 90}ms` }} className={`${card} p-6 hover:border-white/[0.16]`}>
                    <p className="font-mono text-[11px] tracking-[0.15em] text-zinc-600">{b.n} · <span style={{ color: gold }}>{b.k.toUpperCase()}</span></p>
                    <h3 className="mt-3 text-lg font-semibold text-white" style={{ fontFamily: "var(--font-display)" }}>{b.h}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-zinc-400">{b.p}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ---------- checks ---------- */}
          <section id="checks" className="scroll-mt-16">
            <div className="mx-auto max-w-6xl px-6 py-20">
              <div data-reveal className="text-center mb-10">
                <p className={`${eyebrow} mb-3`} style={{ color: gold }}>Coverage</p>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>What we stand guard against</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {CHECKS.map(([h, p], i) => (
                  <div key={h} data-reveal style={{ transitionDelay: `${i * 70}ms` }} className={`${card} p-5 hover:border-white/[0.16]`}>
                    <h3 className="font-medium text-zinc-100">{h}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-500">{p}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ---------- pricing ---------- */}
          <section id="pricing" className="scroll-mt-16">
            <div className="mx-auto max-w-6xl px-6 py-20">
              <div data-reveal className="text-center mb-10">
                <p className={`${eyebrow} mb-3`} style={{ color: gold }}>Pricing</p>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>Simple pricing</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {TIERS.map((t, i) => (
                  <div key={t.name} data-reveal style={{ transitionDelay: `${i * 90}ms` }} className={`rounded-2xl border p-6 bg-white/[0.02] ${t.hot ? "border-[#e3b341]/40 ring-1 ring-[#e3b341]/20" : "border-white/[0.08]"}`}>
                    <div className="flex items-baseline justify-between">
                      <h3 className="font-semibold text-white">{t.name}</h3>
                      {t.hot && <span className="font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: gold }}>Most popular</span>}
                    </div>
                    <p className="mt-3 text-3xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>{t.price}<span className="text-base font-normal text-zinc-500">{t.per}</span></p>
                    <p className="text-sm text-zinc-500">{t.tag}</p>
                    <ul className="mt-5 space-y-2 text-sm text-zinc-300">
                      {t.feats.map((f) => <li key={f} className="flex gap-2"><Check /><span>{f}</span></li>)}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="mt-6 text-center text-sm text-zinc-600">One-time done-with-you remediation audits also available. No access to your servers required.</p>
            </div>
          </section>

          {/* ---------- CTA band ---------- */}
          <section>
            <div className="mx-auto max-w-6xl px-6 py-20">
              <div data-reveal className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-14 text-center">
                <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-[300px] w-[600px] rounded-full" style={{ background: "radial-gradient(closest-side, rgba(227,179,65,0.12), transparent)" }} />
                <div className="relative">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>Armor your site.</h2>
                  <p className="mt-2 text-zinc-400">Free scan. No account. Results in under a minute.</p>
                  <a href="#scan" className="mt-7 inline-block rounded-lg px-7 py-3 font-semibold text-[#0b0a08] transition hover:brightness-110" style={{ background: gold }}>Scan my site →</a>
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {/* ---------- footer ---------- */}
      <footer className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-6 pt-14 pb-4">
          <div className="relative z-10 flex flex-col sm:flex-row justify-between gap-10">
            <div className="max-w-[240px]">
              <div className="flex items-center gap-1.5">
                <span className="text-lg font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>Auramite</span>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: gold }} />
              </div>
              <p className="mt-2.5 text-[13px] leading-relaxed text-zinc-600">Armor for your site. We watch it like an eagle. Plain-English explanation of measurable findings — not legal advice.</p>
            </div>
            <div className="flex gap-14 text-[13px]">
              <div className="flex flex-col gap-2.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Product</span>
                <a href="#scan" className="text-zinc-400 hover:text-white transition-colors">Free scan</a>
                <a href="#how" className="text-zinc-400 hover:text-white transition-colors">How it works</a>
                <a href="#pricing" className="text-zinc-400 hover:text-white transition-colors">Pricing</a>
              </div>
              <div className="flex flex-col gap-2.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Company</span>
                <a href="/privacy" className="text-zinc-400 hover:text-white transition-colors">Privacy</a>
                <a href="/terms" className="text-zinc-400 hover:text-white transition-colors">Terms</a>
                <a href="mailto:hello@auramite.io" className="text-zinc-400 hover:text-white transition-colors">Contact</a>
              </div>
            </div>
          </div>
          <p className="relative z-10 mt-12 text-xs text-zinc-700">© {new Date().getFullYear()} Auramite</p>
          <div aria-hidden className="pointer-events-none select-none -mt-4 text-center">
            <span className="watermark watermark--dim font-bold tracking-tighter whitespace-nowrap" style={{ fontFamily: "var(--font-display)", fontSize: "17vw", lineHeight: 1 }}>AURAMITE</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
