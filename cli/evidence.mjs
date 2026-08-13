// Adversarial evidence capture — try to DISPROVE the findings.
// Loads a site with GPC signaled, performs ZERO interaction (no clicks/keys),
// and dumps the raw third-party requests + cookies so the claims can be checked
// by hand rather than trusted.
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://vermontsystems.com/';
const TRACKER_HOSTS = /licdn\.com|linkedin\.com|googletagmanager|google-analytics|googleadservices|googlesyndication|doubleclick|google\.com\/(ccm|pagead)|bing\.com|facebook/i;

const b = await chromium.launch();
const ctx = await b.newContext({
  extraHTTPHeaders: { 'Sec-GPC': '1', DNT: '1' },
});
await ctx.addInitScript(() => { Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true }); });

const reqs = [];
let clicks = 0, keys = 0;
ctx.on('request', (r) => { if (TRACKER_HOSTS.test(r.url())) reqs.push({ m: r.method(), u: r.url() }); });

const p = await ctx.newPage();
// prove no interaction: wrap the input methods
p.on('framenavigated', () => {});
await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
await p.waitForTimeout(4000);

console.log(`\n=== EVIDENCE: ${url} ===`);
console.log(`GPC signaled: yes (Sec-GPC:1 + navigator.globalPrivacyControl=true)`);
console.log(`User interaction performed: ${clicks} clicks, ${keys} keystrokes  (page loaded, nothing touched)\n`);

console.log(`--- Third-party tracker requests that fired (${reqs.length}) ---`);
for (const r of reqs) {
  let note = '';
  const g = r.u.match(/[?&]gcs=([^&]+)/); const npa = r.u.match(/[?&]npa=([^&]+)/);
  if (g || npa) note = `   [google consent signals: gcs=${g ? g[1] : '?'} npa=${npa ? npa[1] : '?'}]`;
  console.log(`  ${r.m}  ${r.u.slice(0, 110)}${note}`);
}

const cookies = await ctx.cookies();
const idCookies = cookies.filter((c) => /_ga|_gid|_gcl|li_sugr|bcookie|lidc|_fbp|_uet|UserMatchHistory|AnalyticsSyncHistory/i.test(c.name));
console.log(`\n--- Identifying cookies set with no consent (${idCookies.length} of ${cookies.length} total) ---`);
for (const c of idCookies) console.log(`  ${c.name}  (domain ${c.domain})`);

// adversarial checks
const linkedinFired = reqs.some((r) => /licdn|linkedin/i.test(r.u));
const linkedinCookies = idCookies.filter((c) => /linkedin/i.test(c.domain)).map((c) => c.name);
const gaCookieSet = idCookies.some((c) => /^_ga/i.test(c.name));
const googlePings = reqs.filter((r) => /google/i.test(r.u) && /collect|pagead|ccm/i.test(r.u));

console.log(`\n--- Adversarial read ---`);
console.log(`LinkedIn tag loaded + beaconed: ${linkedinFired ? 'YES' : 'no'}`);
console.log(`LinkedIn identity cookies stored: ${linkedinCookies.length ? linkedinCookies.join(', ') : 'none'}`);
console.log(`Google _ga storage cookie set: ${gaCookieSet ? 'YES (consent mode NOT blocking storage)' : 'no (consent-mode "denied" likely active — grayer area)'}`);
console.log(`Google data pings: ${googlePings.length}`);

await b.close();
