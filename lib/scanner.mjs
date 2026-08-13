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

/**
 * Fetches and applies robots.txt for the `*` user-agent group.
 *
 * Used for prospecting only. A customer who has asked us to watch their own
 * page has given us authority directly, and robots.txt is not the channel for
 * withdrawing it — but a site we approach uninvited has said all it is going to
 * say through that file, so we listen.
 *
 * Deliberately conservative: any fetch failure, timeout or unparseable file is
 * treated as "allowed", matching how crawlers behave, but an explicit Disallow
 * covering the path blocks the scan.
 */
export async function robotsAllows(targetUrl, timeoutMs = 8000) {
  let u;
  try { u = new URL(targetUrl); } catch { return { allowed: true, reason: 'unparseable url' }; }

  let text;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(new URL('/robots.txt', u.origin), { signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(timer);
    // 4xx/5xx means no usable robots.txt, which crawlers treat as full allow.
    if (!res.ok) return { allowed: true, reason: `robots.txt returned ${res.status}` };
    text = await res.text();
  } catch {
    return { allowed: true, reason: 'robots.txt unreachable' };
  }

  // Collect the rules that apply to "*", ignoring groups aimed at named bots.
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  let inStar = false;
  let sawStar = false;
  const rules = [];
  for (const line of lines) {
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      inStar = value === '*';
      if (inStar) sawStar = true;
      continue;
    }
    if (!inStar) continue;
    if (field === 'allow' || field === 'disallow') rules.push({ allow: field === 'allow', path: value });
  }
  if (!sawStar) return { allowed: true, reason: 'no rules for *' };

  const path = u.pathname + (u.search || '');
  // Longest matching prefix wins, and Allow beats Disallow at equal length —
  // the behaviour Google and the RFC 9309 draft both describe.
  let best = null;
  for (const r of rules) {
    if (r.path === '') continue; // "Disallow:" with no value means allow all
    if (!path.startsWith(r.path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  if (best && !best.allow) return { allowed: false, reason: `robots.txt disallows ${best.path} for *` };
  return { allowed: true, reason: best ? `robots.txt allows ${best.path}` : 'no matching rule' };
}

export async function scanOne(browser, url, { sendGPC = true, writeReports = true, respectRobots = false } = {}) {
  if (respectRobots) {
    const verdict = await robotsAllows(url);
    if (!verdict.allowed) {
      return { url, host: hostOf(url), skipped: true, skippedReason: verdict.reason, findings: [], highCount: 0 };
    }
  }
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
      // Opt-out controls are frequently NOT plain anchors: they are buttons that
      // open a preferences modal, icon links whose only label is an aria-label,
      // or live inside a consent tool's shadow DOM. Collecting <a href> alone is
      // what produced false "no opt-out link" accusations, so cast wider and
      // record how each candidate was found.
      const nodes = [];
      const collect = (root, depth) => {
        if (!root || depth > 4) return;
        let els = [];
        try { els = Array.from(root.querySelectorAll('a, button, [role="button"], [role="link"], input[type="button"], input[type="submit"]')); } catch { return; }
        for (const el of els) nodes.push(el);
        let hosts = [];
        try { hosts = Array.from(root.querySelectorAll('*')).filter((e) => e.shadowRoot); } catch { hosts = []; }
        for (const h of hosts) collect(h.shadowRoot, depth + 1);
      };
      collect(document, 0);

      const labelOf = (el) => {
        const parts = [
          (el.textContent || '').trim(),
          el.getAttribute && (el.getAttribute('aria-label') || ''),
          el.getAttribute && (el.getAttribute('title') || ''),
          el.getAttribute && (el.getAttribute('value') || ''),
        ];
        try {
          for (const img of el.querySelectorAll('img[alt]')) parts.push(img.getAttribute('alt') || '');
        } catch {}
        return parts.filter(Boolean).join(' ').trim().slice(0, 160);
      };

      out.links = nodes
        .map((el) => ({
          text: labelOf(el),
          href: el.href || el.getAttribute?.('href') || '',
          tag: (el.tagName || '').toLowerCase(),
        }))
        .filter((l) => l.href || l.text);
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
    result.foundLinks[key] = hit
      ? { label: spec.label, text: hit.text, href: hit.href, via: hit.tag }
      : { label: spec.label, found: false };
  }

  // --- Termly-hosted policy ---
  const termlyDocLink = pageData.links.find((l) => /app\.termly\.io\/document/i.test(l.href));
  if (termlyDocLink && !result.cmps.some((c) => c.id === 'termly')) result.cmps.push({ id: 'termly', name: 'Termly', via: 'policy-link' });
  result.usesTermly = result.cmps.some((c) => c.id === 'termly');

  result.gpcIgnoredHard = result.sentGPC && result.hardSaleShare.length > 0;

  // Proving a link is ABSENT is far harder than proving one is present, and
  // "this business offers consumers no way to opt out" is the most damaging
  // thing this tool can say about someone. So absence is only asserted when
  // nothing could plausibly be concealing it. A consent tool commonly carries
  // the opt-out control inside its own preferences dialog, which a single page
  // load never opens — in that case we report that we could not verify it,
  // which is true, rather than that it is missing, which we do not know.
  const optOutFound = result.foundLinks.optOut?.found !== false;
  const concealable = result.cmps.length > 0 || Boolean(result.loadError);
  result.optOutMissingWhileSharing = result.hardSaleShare.length > 0 && !optOutFound && !concealable;
  result.optOutUnverified = result.hardSaleShare.length > 0 && !optOutFound && concealable;
  result.optOutUnverifiedReason = !result.optOutUnverified
    ? null
    : result.loadError
      ? 'the page did not finish loading'
      : `${result.cmps.map((c) => c.name).join(', ')} may carry it inside a preferences dialog we do not open`;

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

  if (r.optOutMissingWhileSharing) f.push({ sev: 'high', msg: `Sharing identifiers, and no "Do Not Sell/Share" / "Your Privacy Choices" control was found anywhere on the page.` });
  if (r.optOutUnverified) f.push({ sev: 'info', msg: `Sharing identifiers, and we could not confirm a "Do Not Sell/Share" control — ${r.optOutUnverifiedReason}. Not asserted as missing; verify by hand.` });
  // Policies are routinely published as opaque PDF URLs on a marketing
  // subdomain, which no text or href pattern can recognize. This stays
  // informational for that reason — it is a prompt to look, not a finding.
  if (r.foundLinks.privacyPolicy?.found === false) f.push({ sev: 'info', msg: `No Privacy Policy link was detected automatically (it may be a PDF, on another domain, or rendered after load). Verify before relying on this.` });
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
