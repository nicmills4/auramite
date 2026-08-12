"use client";

import { useState } from "react";

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

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");
  const [showConsult, setShowConsult] = useState(false);
  const [consultEmail, setConsultEmail] = useState("");
  const [consultSent, setConsultSent] = useState(false);
  const [copied, setCopied] = useState(false);

  async function runScan(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const res = await fetch("/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const data = await res.json();
      if (!data.ok) setError(data.error || "Scan failed.");
      else setResult(data);
    } catch { setError("Something went wrong. Try again."); }
    finally { setLoading(false); }
  }

  function openConsult() { setConsultSent(false); setShowConsult(true); }

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

  return (
    <main className="flex-1 text-zinc-300">
      <nav className="border-b border-white/10">
        <div className="mx-auto max-w-5xl px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-[22px] font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>Auramite</span>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: gold }} />
          </div>
          <a href="#pricing" className="text-sm text-zinc-400 hover:text-white transition-colors">Pricing</a>
        </div>
      </nav>

      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none select-none absolute inset-0 flex items-center justify-center">
          <span className="font-bold tracking-tighter whitespace-nowrap" style={{ fontFamily: "var(--font-display)", fontSize: "26vw", lineHeight: 1, backgroundImage: "linear-gradient(90deg, rgba(242,202,99,0) 0%, rgba(242,202,99,0.05) 28%, rgba(242,202,99,0.24) 50%, rgba(242,202,99,0.05) 72%, rgba(242,202,99,0) 100%)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", WebkitTextFillColor: "transparent" }}>AURAMITE</span>
        </div>
        <div className="relative z-10 mx-auto max-w-3xl px-5 pt-20 pb-12 text-center">
        <p className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.05] mb-2" style={{ fontFamily: "var(--font-display)", color: gold }}>We watch your site like an eagle</p>
        <h1 className="text-xl sm:text-4xl font-bold tracking-tight leading-[1.15] text-white" style={{ fontFamily: "var(--font-display)" }}>
          See what your website is leaking.
        </h1>
        <p className="mt-5 text-lg text-zinc-400 max-w-2xl mx-auto">
          We load your site as a real visitor and show exactly which trackers send personal data to
          advertisers <span className="text-zinc-100 font-medium">before anyone consents</span> — the issue
          behind 2025&apos;s privacy fines and lawsuits. Free, in ~20 seconds.
        </p>

        <form onSubmit={runScan} className="mt-9 flex flex-col sm:flex-row gap-2.5 max-w-xl mx-auto">
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
        {error && (
          <div className="mt-5 mx-auto max-w-xl rounded-lg border border-red-500/30 bg-red-500/[0.08] px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {loading && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-zinc-400">
            <span className="inline-block h-4 w-4 rounded-full border-2 border-zinc-700 border-t-[#e3b341] animate-spin" />
            <span>Loading your homepage and watching what fires… ~15&ndash;20s.</span>
          </div>
        )}
        </div>
      </section>

      {result && (
        <section className="mx-auto max-w-6xl px-5 pt-12 pb-16">
          <div className="grid gap-4 items-start md:grid-cols-2 lg:grid-cols-3">

            {/* col 1: summary + timeline + verify */}
            <div className="space-y-4">
              <div className={`rounded-xl border p-5 ${leaked ? "border-red-500/30 bg-red-500/[0.07]" : "border-emerald-500/30 bg-emerald-500/[0.07]"}`}>
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
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="grid grid-cols-[56px_1fr] gap-y-3 text-sm">
                    <div className="font-medium text-zinc-500">0.00s</div>
                    <div className="flex gap-2 text-zinc-200"><span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />A visitor opens your homepage.</div>
                    <div className="font-medium text-red-400">{fmtT(result.firstShareMs)}</div>
                    <div className="flex gap-2 text-zinc-200"><span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-red-500 shrink-0" /><span><b className="font-medium text-white">Data already sent to {result.hardShare.join(", ") || "advertisers"}.</b> No one was asked.</span></div>
                    {result.bannerMs != null && (
                      <>
                        <div className="font-medium text-zinc-500">{fmtT(result.bannerMs)}</div>
                        <div className="flex gap-2 text-zinc-400"><span className="mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-zinc-500 shrink-0" />Your cookie banner appears — after the data already left.</div>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="rounded-xl border p-5 text-sm text-zinc-300" style={{ borderColor: "rgba(227,179,65,0.25)", background: "rgba(227,179,65,0.06)" }}>
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
                <div key={ex.key} className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
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

            {/* col 3: locked panel — button below the cards (no overlap) */}
            {result.lockedCount > 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
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
              <div className="rounded-xl border p-5 text-center" style={{ borderColor: "rgba(227,179,65,0.4)", background: "rgba(227,179,65,0.08)" }}>
                <p className="font-semibold text-white">Get {result.host} fixed</p>
                <p className="text-sm text-zinc-400 mt-1 mb-4">Book a free 15-minute consultation — we&apos;ll walk you through the finding, with the proof, and how to fix it.</p>
                <button onClick={openConsult} className="w-full rounded-lg py-2.5 font-semibold text-[#0b0a08] hover:brightness-110" style={{ background: gold }}>Schedule my consultation →</button>
              </div>
            ) : null}

          </div>
        </section>
      )}

      {/* Consultation modal */}
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
          <section className="border-y border-white/10 bg-white/[0.02]">
            <div className="mx-auto max-w-5xl px-5 py-16 grid sm:grid-cols-3 gap-8 text-center">
              {[
                ["1. Scan", "We load your real site and record every tracker that fires before consent — with timestamps."],
                ["2. Prove", "You get a plain-English report with the actual network log as proof, not vague claims."],
                ["3. Fix & monitor", "We show you exactly how to fix each issue, then re-scan on a schedule so it stays fixed."],
              ].map(([h, p]) => (
                <div key={h}><h3 className="font-semibold text-white">{h}</h3><p className="mt-2 text-sm text-zinc-400">{p}</p></div>
              ))}
            </div>
          </section>

          <section className="mx-auto max-w-5xl px-5 py-16">
            <h2 className="text-2xl font-bold tracking-tight text-center text-white" style={{ fontFamily: "var(--font-display)" }}>What we check for</h2>
            <div className="mt-8 grid sm:grid-cols-2 gap-4">
              {[
                ["Ad pixels firing before consent", "Meta, Google, LinkedIn & TikTok tags that share visitor IDs on page load — a CCPA/CPRA “sale/share.”"],
                ["Ignored “Do Not Track” (GPC) signals", "State laws require honoring the browser opt-out signal automatically. Most sites don’t."],
                ["Session recording (CIPA)", "Hotjar/FullStory/Clarity capturing what visitors type — the #1 “wiretapping” lawsuit issue of 2025."],
                ["Video + Meta Pixel (VPPA)", "Tells Facebook which videos a visitor watched — a fast-growing class-action wave."],
                ["A cookie banner that doesn’t block", "Termly/CookieYes installed but not gating anything — the Tractor Supply $1.35M pattern."],
                ["Missing “Your Privacy Choices” opt-out", "Required for any business that sells or shares data."],
              ].map(([h, p]) => (
                <div key={h} className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
                  <h3 className="font-medium text-zinc-100">{h}</h3><p className="mt-1.5 text-sm text-zinc-400">{p}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="pricing" className="border-t border-white/10 bg-white/[0.02]">
            <div className="mx-auto max-w-5xl px-5 py-16">
              <h2 className="text-2xl font-bold tracking-tight text-center text-white" style={{ fontFamily: "var(--font-display)" }}>Simple pricing</h2>
              <div className="mt-8 grid sm:grid-cols-3 gap-4">
                {[
                  { name: "Free scan", price: "$0", per: "", tag: "Find out where you stand", hot: false, feats: ["One-time homepage scan", "Your first finding, in full", "Self-verify instructions"] },
                  { name: "Starter", price: "$99", per: "/mo", tag: "Stay compliant", hot: true, feats: ["1 site, key pages", "Weekly re-scans + alerts", "Step-by-step fix guide", "Email reports"] },
                  { name: "Growth", price: "$299", per: "/mo", tag: "Multi-site & faster", hot: false, feats: ["Up to 5 sites", "Daily scans + GPC checks", "Consent-mode setup guidance", "Priority support"] },
                ].map((t) => (
                  <div key={t.name} className={`rounded-xl border p-6 bg-white/[0.03] ${t.hot ? "border-[#e3b341]/40 ring-1 ring-[#e3b341]/30" : "border-white/10"}`}>
                    <div className="flex items-baseline justify-between">
                      <h3 className="font-semibold text-white">{t.name}</h3>
                      {t.hot && <span className="text-xs font-medium" style={{ color: gold }}>Most popular</span>}
                    </div>
                    <p className="mt-3 text-3xl font-bold text-white">{t.price}<span className="text-base font-normal text-zinc-500">{t.per}</span></p>
                    <p className="text-sm text-zinc-500">{t.tag}</p>
                    <ul className="mt-4 space-y-2 text-sm text-zinc-300">
                      {t.feats.map((f) => <li key={f} className="flex gap-2"><svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden><path d="M4 10.5l4 4 8-9" stroke="#e3b341" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg><span>{f}</span></li>)}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="mt-6 text-center text-sm text-zinc-500">One-time done-with-you remediation audits also available. No access to your servers required.</p>
            </div>
          </section>
        </>
      )}

      <footer className="border-t border-white/10">
        <div className="mx-auto max-w-5xl px-5 py-8 text-sm text-zinc-500 flex flex-col sm:flex-row justify-between gap-2">
          <span>© {new Date().getFullYear()} <span className="font-bold text-zinc-300" style={{ fontFamily: "var(--font-display)" }}>Auramite</span> · <a href="/privacy" className="hover:text-white">Privacy</a> · <a href="/terms" className="hover:text-white">Terms</a></span>
          <span>Plain-English explanation of measurable findings — not legal advice.</span>
        </div>
      </footer>
    </main>
  );
}
