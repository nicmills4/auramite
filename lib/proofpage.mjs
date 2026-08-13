// Shared proof-page renderer. Returns standalone HTML (inline CSS, no external deps).
import { buildExplainers, fmtT, friendly, listAnd } from './explainers.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderProofPage(scan, host) {
  const explainers = buildExplainers(scan);
  const hasLeak = (scan.findings || []).some((f) => f.sev === 'high');
  const hard = scan.hardSaleShare || [];
  const firstShare = hard.length ? Math.min(...hard.map((t) => t.t || 0)) : null;
  const nets = listAnd(hard.map((t) => friendly(t.name)));
  const bannerMs = scan.bannerMs;
  const today = new Date().toISOString().slice(0, 10);

  const renderLog = (lines) => !lines || !lines.length ? '' :
    `<div class="log">${lines.map((l) => `<div class="ll${l.danger ? ' dl' : ''}${l.ok ? ' ok' : ''}">${esc(l.text)}</div>`).join('')}</div>`;

  const tlRow = (t, html, cls) => `<div class="tlt ${cls}">${esc(t)}</div><div class="tlx"><span class="dot ${cls}"></span><span>${html}</span></div>`;

  let timeline = '';
  if (firstShare != null) {
    const rows = [tlRow('0.00s', 'A visitor opens your homepage.', 'ok'),
      tlRow(fmtT(firstShare), `<b>Their data is already sent to ${esc(nets)}</b> — advertising networks. No one was asked.`, 'bad')];
    if (bannerMs != null) {
      const diff = (bannerMs - firstShare) / 1000;
      rows.push(tlRow(fmtT(bannerMs), `Your “We value your privacy” banner finally appears.${diff > 0 ? ` The data already left ${diff.toFixed(1)}s earlier.` : ''}`, 'muted'));
    } else rows.push(tlRow('—', 'No consent banner was detected on the page at all.', 'muted'));
    timeline = `<div class="card"><div class="tl">${rows.join('')}</div><p class="quote">The banner asks permission for something that already happened.</p></div>`;
  }

  const explainersHTML = explainers.map((e) => `
    <div class="card">
      <div class="vh"><span class="chip ${e.severity === 'HIGH' ? 'hi' : 'md'}">${e.severity}</span><span class="vt">${esc(e.title)}</span></div>
      <p>${esc(e.paragraph)}</p>
      ${renderLog(e.logLines)}
      <p class="rule"><b>The rule &amp; precedent:</b> ${esc(e.rule)}</p>
    </div>`).join('');

  const cmpNames = (scan.cmps || []).map((c) => c.name).join(' + ');
  const headline = hasLeak
    ? `Your website sent a visitor’s personal data to advertising companies <span class="red">before they agreed to anything</span>.`
    : `We scanned ${esc(host)} and found no obvious pre-consent data sharing.`;
  const badge = hasLeak ? `<span class="badge">DATA LEAK DETECTED</span>` : `<span class="badge ok">SCAN COMPLETE</span>`;

  const css = `:root{color-scheme:light}*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f4f4f2;color:#1c1c1a;margin:0;padding:24px;line-height:1.6}
.wrap{max-width:680px;margin:0 auto}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.host{font-weight:500;font-size:15px}.badge{font-size:12px;font-weight:500;color:#b42318;background:#fef3f2;padding:4px 10px;border-radius:999px}
.badge.ok{color:#067647;background:#ecfdf3}h1{font-size:23px;font-weight:600;line-height:1.3;margin:8px 0 4px}.red{color:#b42318}
.sub{color:#6b6b66;font-size:14px;margin:0 0 20px}.card{background:#fff;border:1px solid #e6e4df;border-radius:12px;padding:18px 20px;margin-bottom:14px}
.card.info{background:#eff8ff;border-color:#b2ddff;color:#175cd3}.card.warn{background:#fffaeb;border-color:#fedf89;color:#93370d}.card p{margin:0 0 12px;font-size:15px}
.tl{display:grid;grid-template-columns:60px 1fr;row-gap:14px;align-items:start}.tlt{font-weight:500;color:#6b6b66}.tlt.bad{color:#b42318}
.tlx{display:flex;gap:10px}.dot{margin-top:6px;width:10px;height:10px;border-radius:50%;flex:none;background:#9a9a93}
.dot.ok{background:#067647}.dot.bad{background:#b42318}.dot.muted{background:transparent;border:2px solid #9a9a93}
.quote{font-style:italic;color:#6b6b66;font-size:13px;margin:14px 0 0;padding-top:12px;border-top:1px solid #eceae5}
.vh{display:flex;align-items:center;gap:10px;margin-bottom:10px}.chip{font-size:12px;font-weight:500;padding:3px 9px;border-radius:999px}
.chip.hi{color:#b42318;background:#fef3f2}.chip.md{color:#93370d;background:#fffaeb}.vt{font-size:16px;font-weight:500}
.rule{font-size:13px;color:#6b6b66;margin:0;padding-top:10px;border-top:1px solid #eceae5}
.log{background:#f6f6f3;border:1px solid #e6e4df;border-radius:8px;padding:11px 13px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.85;color:#5a5a54;overflow-x:auto;white-space:nowrap;margin:0 0 12px}
.ll.dl{color:#b42318;font-weight:500}.ll.ok{color:#067647}.cta{text-align:center;color:#6b6b66;font-size:13px;margin:14px 0 0}
.foot{text-align:center;color:#9a9a93;font-size:12px;margin-top:8px;font-style:italic}`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Privacy scan — ${esc(host)}</title><style>${css}</style></head><body><div class="wrap">
<div class="top"><span class="host">${esc(host)}</span>${badge}</div>
<h1>${headline}</h1>
<p class="sub">We opened your homepage one time and watched what happened. We clicked nothing.${scan.loadError ? ' (Note: the page did not fully load during the scan.)' : ''}</p>
${timeline}
${explainersHTML}
<div class="card info"><div class="vt">Don’t take our word for it — see it yourself (30 sec)</div><p style="margin-bottom:0">Open your homepage in Chrome → press <b>F12</b> → click <b>Network</b> → type <b>linkedin</b> → reload. Every row is your visitor’s data leaving for LinkedIn. Or paste your site into the journalists’ free tool at <b>blacklight.themarkup.org</b>.</p></div>
<div class="card warn"><div class="vt">Why this matters</div><p style="margin-bottom:0">Regulators fined Tractor Supply <b>$1.35M in 2025</b> for this exact setup — a cookie banner that didn’t actually stop the tracking.${cmpNames ? ` Your site runs <b>${esc(cmpNames)}</b> — it isn’t stopping it.` : ''}</p></div>
<p class="cta">We can show you this happening live in 20 seconds — and fix it.</p>
<div class="card"><div class="vt">What this is, and what it isn’t</div><p style="margin-bottom:0">This is a record of what one automated visit to <b>${esc(host)}</b> observed on ${today} — which requests the page made, and when. Auramite is not a law firm and this is not legal advice; whether any of it amounts to a violation depends on facts we don’t assess and is a judgement for your counsel. A single automated page load can also miss things: controls inside a consent dialog, policies published as PDFs, and content that renders only after interaction are all outside what it can see. Treat every item here as something to verify, not as a finding of fact — and if we’ve got something wrong, tell us and we’ll re-scan and correct it.</p></div>
<p class="foot">Observations from an automated page load — not legal advice, and not a certification of compliance. Scanned ${today}.</p>
</div></body></html>`;

  return { html, explainers, firstShareMs: firstShare, bannerMs };
}
