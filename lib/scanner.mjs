// Core scan engine — shared by scan.mjs, batch.mjs, diagnose.mjs.
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { TRACKERS, TRACKING_COOKIES, CMPS, CONSENT_APIS, CHAT_WIDGETS, VIDEO_SIGNS, REQUIRED_LINKS } from './signatures.mjs';

const SETTLE_MS = 7000;
const NAV_TIMEOUT_MS = 45000;

export function normalizeUrl(u) {
  if (!/^https?:\/\//i.test(u)) return 'https://' + u;
  return u;
}
export function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u.replace(/[^a-z0-9.-]/gi, '_'); }
}
export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
export const SEV_ICON = { high: '🔴', medium: '🟠', info: 'ℹ️', ok: '✅' };

// --- Google Consent Mode analysis ---------------------------------------
// gcs param = "G1" + ad_storage + analytics_storage (e.g. G100 = both denied,
// G111 = both granted). If Google tags fire with ad_storage denied AND no storage
// cookie was set, they're running cookieless/denied — a grayer area, NOT a clean
// "sale/share" the way a fully-firing pixel (LinkedIn/Meta) is.
function analyzeGoogleConsent(requests) {
  let adDenied = false, adGranted = false, npa = false, sawGcs = false;
  for (const r of requests) {
    const u = r.url;
    if (!/google|doubleclick|googlesyndication|googleadservices/i.test(u)) continue;
    const m = u.match(/[?&]gcs=(G1[01xX][01xX])/);
    if (m) { sawGcs = true; const ad = m[1][2]; if (ad === '0') adDenied = true; if (ad === '1') adGranted = true; }
    if (/[?&]npa=1/.test(u)) npa = true;
  }
  return { sawGcs, adDenied, adGranted, npa };
}

export async function scanOne(browser, url, { sendGPC = true, writeReports = true } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
    extraHTTPHeaders: sendGPC ? { 'Sec-GPC': '1', DNT: '1' } : {},
  });
  if (sendGPC) {
    await context.addInitScript(() => {
      try { Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true, configurable: true }); } catch {}
    });
  }

  let navStart = 0;
  const requests = [];
  context.on('request', (req) => { requests.push({ url: req.url(), type: req.resourceType(), method: req.method(), at: Date.now() }); });

  const page = await context.newPage();
  const result = { url, sentGPC: sendGPC, loadError: null };

  // Consent-banner appearance time — measured concurrently so the proof timeline
  // ("banner appears AFTER trackers fired") is real, not asserted.
  const bannerSelectors = CMPS.flatMap((c) => c.selectors || []).concat(['#cmp-banner']);
  let bannerMs = null;

  try {
    navStart = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    page.waitForSelector(bannerSelectors.join(','), { timeout: 15000, state: 'attached' })
      .then(() => { if (bannerMs == null) bannerMs = Math.max(0, Date.now() - navStart); })
      .catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
    // nudge lazy-loaded tags (many ad tags fire only on first scroll / late idle),
    // so a single load doesn't falsely report a leaking site as clean.
    try { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); } catch {}
    await page.waitForTimeout(2000);
  } catch (e) { result.loadError = String(e.message || e); }

  const tOf = (at) => Math.max(0, at - navStart);
  result.bannerMs = bannerMs;

  // --- trackers that fired (with first-fire timestamp) ---
  const firedMap = new Map();
  for (const req of requests) {
    const u = req.url.toLowerCase();
    for (const t of TRACKERS) {
      if (t.match.some((m) => u.includes(m))) {
        if (!firedMap.has(t.name)) firedMap.set(t.name, { ...t, hits: 0, sample: req.url, firstAt: req.at, method: req.method });
        const e = firedMap.get(t.name); e.hits++;
        if (req.at < e.firstAt) { e.firstAt = req.at; e.sample = req.url; e.method = req.method; }
      }
    }
  }
  const trackers = [...firedMap.values()].map(({ match, firstAt, ...rest }) => ({ ...rest, t: tOf(firstAt) }));

  // --- cookies ---
  let cookies = [];
  try { cookies = await context.cookies(); } catch {}
  result.trackingCookies = cookies
    .filter((c) => TRACKING_COOKIES.some((tc) => c.name.includes(tc.match)))
    .map((c) => ({ name: c.name, domain: c.domain, expires: c.expires }));
  result.totalCookies = cookies.length;

  // --- consent-mode classification: hard vs gray sale/share (FIX B) ---
  const gc = analyzeGoogleConsent(requests);
  const googleStorageCookie = cookies.some((c) => /^_ga|^_gcl|^IDE$|^_gid/.test(c.name));
  for (const t of trackers) {
    if (!t.saleShare) { t.violation = 'n/a'; continue; }
    const isGoogleAds = /google ads|doubleclick/i.test(t.name);
    if (isGoogleAds) {
      if (gc.adGranted || googleStorageCookie) { t.violation = 'hard'; t.consentMode = 'granted/none'; }
      else if (gc.adDenied) { t.violation = 'gray'; t.consentMode = 'denied (cookieless)'; }
      else { t.violation = 'hard'; t.consentMode = 'none'; }
    } else {
      // LinkedIn/Meta/TikTok/etc. — no consent-mode signal; fired fully.
      t.violation = 'hard'; t.consentMode = 'none';
    }
  }
  result.trackers = trackers;
  result.saleShareTrackers = trackers.filter((t) => t.saleShare);
  result.hardSaleShare = trackers.filter((t) => t.saleShare && t.violation === 'hard');
  result.graySaleShare = trackers.filter((t) => t.saleShare && t.violation === 'gray');
  result.sessionRecorders = trackers.filter((t) => t.category === 'session-recording');
  result.hasMetaPixel = trackers.some((t) => /meta|facebook/i.test(t.name));
  result.googleConsentMode = gc;

  // --- in-page: CMP, consent APIs, links, chat, video, page meta ---
  let pageData = { cmps: [], consentApis: [], links: [], gpcJs: undefined, chats: [], hasVideo: false, meta: {} };
  try {
    pageData = await page.evaluate((args) => {
      const { cmps, consentApis, chats, videoSel } = args;
      const out = { cmps: [], consentApis: [], links: [], gpcJs: undefined, chats: [], hasVideo: false, meta: {} };
      try { out.gpcJs = navigator.globalPrivacyControl; } catch {}
      for (const cmp of cmps) {
        const byGlobal = (cmp.globals || []).some((g) => typeof window[g] !== 'undefined');
        const byDom = (cmp.selectors || []).some((s) => { try { return !!document.querySelector(s); } catch { return false; } });
        if (byGlobal || byDom) out.cmps.push({ id: cmp.id, name: cmp.name, via: byGlobal ? 'global' : 'dom' });
      }
      for (const api of consentApis) if (typeof window[api] === 'function') out.consentApis.push(api);
      for (const c of chats) {
        const byGlobal = (c.globals || []).some((g) => typeof window[g] !== 'undefined');
        const byDom = (c.selectors || []).some((s) => { try { return !!document.querySelector(s); } catch { return false; } });
        if (byGlobal || byDom) out.chats.push({ name: c.name, via: byGlobal ? 'global' : 'dom' });
      }
      try { out.hasVideo = videoSel.some((s) => { try { return !!document.querySelector(s); } catch { return false; } }); } catch {}
      const anchors = Array.from(document.querySelectorAll('a'));
      out.links = anchors.map((a) => ({ text: (a.textContent || '').trim().slice(0, 80), href: a.href })).filter((l) => l.href);
      out.meta.title = (document.title || '').slice(0, 120);
      const md = document.querySelector('meta[name="description"]');
      out.meta.desc = (md ? md.getAttribute('content') || '' : '').slice(0, 200);
      const h1 = document.querySelector('h1');
      out.meta.h1 = (h1 ? h1.textContent || '' : '').trim().slice(0, 120);
      return out;
    }, { cmps: CMPS, consentApis: CONSENT_APIS, chats: CHAT_WIDGETS, videoSel: VIDEO_SIGNS.selectors });
  } catch {}

  // CMP / chat can also be inferred from request domains
  const cmpByRequest = [];
  for (const cmp of CMPS) {
    if (cmp.domains.some((d) => requests.some((r) => r.url.toLowerCase().includes(d)))) {
      if (!pageData.cmps.some((c) => c.id === cmp.id)) cmpByRequest.push({ id: cmp.id, name: cmp.name, via: 'request' });
    }
  }
  result.cmps = [...pageData.cmps, ...cmpByRequest];
  const chatByRequest = [];
  for (const c of CHAT_WIDGETS) {
    if (c.domains.some((d) => requests.some((r) => r.url.toLowerCase().includes(d)))) {
      if (!pageData.chats.some((x) => x.name === c.name)) chatByRequest.push({ name: c.name, via: 'request' });
    }
  }
  result.chats = [...pageData.chats, ...chatByRequest];
  result.hasChat = result.chats.length > 0;
  result.hasVideo = pageData.hasVideo;
  result.consentApis = pageData.consentApis;
  result.gpcReflectedInJs = pageData.gpcJs;
  result.pageMeta = pageData.meta;

  // --- required links ---
  result.foundLinks = {};
  for (const [key, spec] of Object.entries(REQUIRED_LINKS)) {
    const hit = pageData.links.find((l) => spec.text.some((re) => re.test(l.text)) || spec.href.some((re) => re.test(l.href)));
    result.foundLinks[key] = hit ? { label: spec.label, text: hit.text, href: hit.href } : { label: spec.label, found: false };
  }

  // --- Termly-hosted policy ---
  const termlyDocLink = pageData.links.find((l) => /app\.termly\.io\/document/i.test(l.href));
  if (termlyDocLink && !result.cmps.some((c) => c.id === 'termly')) result.cmps.push({ id: 'termly', name: 'Termly', via: 'policy-link' });
  result.usesTermly = result.cmps.some((c) => c.id === 'termly');

  result.gpcIgnoredHard = result.sentGPC && result.hardSaleShare.length > 0;
  result.optOutMissingWhileSharing = result.hardSaleShare.length > 0 && result.foundLinks.optOut?.found === false;

  // --- verdict ---
  result.findings = scoreFindings(result);
  result.verdict = verdictOf(result.findings);
  result.highCount = result.findings.filter((f) => f.sev === 'high').length;

  if (writeReports) {
    const dir = join('reports', `${hostOf(url)}-${stamp()}`);
    await mkdir(dir, { recursive: true });
    try { await page.screenshot({ path: join(dir, 'screenshot.png'), fullPage: true }); result.screenshot = join(dir, 'screenshot.png'); } catch {}
    await writeFile(join(dir, 'report.json'), JSON.stringify(result, null, 2));
    await writeFile(join(dir, 'report.md'), renderMarkdown(result));
    result.reportDir = dir;
  }

  await context.close();
  return result;
}

export function scoreFindings(r) {
  const f = [];
  const hasCMP = r.cmps.length > 0;
  const cmpNames = r.cmps.map((c) => c.name).join(', ');

  if (r.loadError) f.push({ sev: 'info', msg: `Page failed to fully load: ${r.loadError}` });

  // HARD sale/share only (consent-mode-denied Google excluded) — FIX B
  if (r.hardSaleShare.length) {
    const names = r.hardSaleShare.map((t) => t.name).join(', ');
    if (hasCMP) f.push({ sev: 'high', msg: `Consent tool present (${cmpNames}) but ${r.hardSaleShare.length} tracker(s) fully shared an identifier BEFORE consent: ${names}. The banner is not gating them.` });
    else f.push({ sev: 'high', msg: `${r.hardSaleShare.length} tracker(s) fully shared an identifier with no consent gate: ${names}.` });
  }
  if (r.gpcIgnoredHard) f.push({ sev: 'high', msg: `GPC was signaled, yet ${r.hardSaleShare.map((t) => t.name).join(', ')} still shared data — GPC not honored (the Tractor Supply / Sephora fact pattern).` });

  // GRAY: Google in consent-mode-denied — note, don't over-flag
  if (r.graySaleShare.length) f.push({ sev: 'info', msg: `${r.graySaleShare.map((t) => t.name).join(', ')} fired but in Consent Mode "denied" (cookieless, no storage cookie set) — lower risk; verify before asserting a violation.` });

  if (r.hardSaleShare.length && r.foundLinks.optOut?.found === false) f.push({ sev: 'high', msg: `Sharing identifiers but NO "Do Not Sell/Share" / "Your Privacy Choices" link found.` });
  if (r.foundLinks.privacyPolicy?.found === false) f.push({ sev: 'medium', msg: `No Privacy Policy link detected on the homepage (verify — may be in footer/PDF/JS-rendered).` });
  if (r.trackingCookies.length) f.push({ sev: hasCMP ? 'high' : 'medium', msg: `${r.trackingCookies.length} tracking cookie(s) set before consent: ${r.trackingCookies.map((c) => c.name).join(', ')}.` });
  if (r.sessionRecorders.length) f.push({ sev: 'medium', msg: `Session recording active (${r.sessionRecorders.map((t) => t.name).join(', ')}) — a primary CIPA target; captures user input incl. PII.` });
  if (r.hasChat) f.push({ sev: 'info', msg: `Chat widget present (${r.chats.map((c) => c.name).join(', ')}) — CIPA wiretapping exposure.` });
  if (r.hasVideo && r.hasMetaPixel) f.push({ sev: 'medium', msg: `Video content + Meta Pixel present — VPPA class-action exposure (video viewing tied to a Facebook ID).` });

  if (f.length === 0) f.push({ sev: 'ok', msg: 'No obvious pre-consent identifier sharing or missing-link gaps detected. (Manual review still advised.)' });
  return f;
}

export function verdictOf(findings) {
  if (findings.some((f) => f.sev === 'high')) return 'LIKELY NON-COMPLIANT — review the high-severity findings';
  if (findings.some((f) => f.sev === 'medium')) return 'POSSIBLE GAPS — worth a closer look';
  return 'NO OBVIOUS GAPS detected by automated scan';
}

export function renderMarkdown(r) {
  const lines = [];
  lines.push(`# Privacy audit — ${r.url}`, '');
  lines.push(`**Verdict:** ${r.verdict}`, '');
  lines.push(`- GPC/DNT signaled: **${r.sentGPC ? 'yes' : 'no'}**`);
  lines.push(`- Consent tool (CMP): **${r.cmps.length ? r.cmps.map((c) => `${c.name} [${c.via}]`).join(', ') : 'none'}**`);
  lines.push(`- Hard sale/share (identifier shared pre-consent): **${r.hardSaleShare.map((t) => t.name).join(', ') || 'none'}**`);
  lines.push(`- Gray (Consent-Mode-denied, cookieless): ${r.graySaleShare.map((t) => t.name).join(', ') || 'none'}`);
  lines.push(`- Session replay: ${r.sessionRecorders.map((t) => t.name).join(', ') || 'none'}`);
  lines.push(`- Chat widget: ${r.chats.map((c) => c.name).join(', ') || 'none'}`);
  lines.push(`- Video + Meta Pixel (VPPA): ${r.hasVideo && r.hasMetaPixel ? 'YES' : 'no'}`);
  lines.push(`- Privacy Policy link: ${r.foundLinks.privacyPolicy?.found === false ? '**not on homepage**' : '`' + (r.foundLinks.privacyPolicy?.href || '') + '`'}`);
  lines.push(`- Opt-out link: ${r.foundLinks.optOut?.found === false ? '**missing**' : '`' + (r.foundLinks.optOut?.href || '') + '`'}`, '');
  lines.push('## Findings');
  for (const f of r.findings) lines.push(`- ${SEV_ICON[f.sev] || ''} **${f.sev.toUpperCase()}** — ${f.msg}`);
  lines.push('', '## Trackers fired before consent');
  if (r.trackers.length) {
    lines.push('| Tracker | Category | Sale/Share | Verdict |', '| --- | --- | --- | --- |');
    for (const t of r.trackers) lines.push(`| ${t.name} | ${t.category} | ${t.saleShare ? 'YES' : 'no'} | ${t.violation || '-'} |`);
  } else lines.push('_None matched._');
  if (r.screenshot) lines.push('', `Evidence screenshot: \`${r.screenshot}\``);
  return lines.join('\n');
}

export function renderConsole(r) {
  const C = { reset: '\x1b[0m', bold: '\x1b[1m', red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', dim: '\x1b[2m', cyan: '\x1b[36m' };
  const vColor = r.verdict.startsWith('LIKELY') ? C.red : r.verdict.startsWith('POSSIBLE') ? C.yellow : C.green;
  console.log('');
  console.log(`${C.bold}${C.cyan}━━ ${r.url} ━━${C.reset}`);
  console.log(`${C.bold}Verdict:${C.reset} ${vColor}${r.verdict}${C.reset}`);
  console.log(`${C.dim}CMP:${C.reset} ${r.cmps.map((c) => c.name).join(', ') || 'none'}   ${C.dim}GPC sent:${C.reset} ${r.sentGPC ? 'yes' : 'no'}`);
  console.log(`${C.dim}Hard share:${C.reset} ${r.hardSaleShare.map((t) => t.name).join(', ') || 'none'}   ${C.dim}Gray:${C.reset} ${r.graySaleShare.map((t) => t.name).join(', ') || 'none'}`);
  console.log(`${C.dim}Session replay:${C.reset} ${r.sessionRecorders.length ? r.sessionRecorders.map((t) => t.name).join(',') : 'no'}   ${C.dim}Chat:${C.reset} ${r.hasChat ? r.chats.map((c) => c.name).join(',') : 'no'}   ${C.dim}Video+Pixel:${C.reset} ${r.hasVideo && r.hasMetaPixel ? 'YES' : 'no'}`);
  for (const f of r.findings) {
    const col = f.sev === 'high' ? C.red : f.sev === 'medium' ? C.yellow : f.sev === 'ok' ? C.green : C.dim;
    console.log(`  ${col}${SEV_ICON[f.sev] || ''} ${f.sev.toUpperCase()}${C.reset} ${f.msg}`);
  }
  if (r.reportDir) console.log(`  ${C.dim}report:${C.reset} ${r.reportDir}`);
}
