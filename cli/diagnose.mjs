#!/usr/bin/env node
// Deep single-site diagnostic — the customer-delivery tool.
//
// Goes beyond the batch scan: classifies HOW each tracker loads (hardcoded in the
// served HTML vs injected later e.g. via GTM), ground-truths the legal links so we
// don't false-flag a "missing" policy that actually exists, and produces a
// remediation-oriented report under customers/<host>/.
//
// Usage: node cli/diagnose.mjs <url>

import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { scanOne, normalizeUrl, hostOf } from '../lib/scanner.mjs';

// Inline signatures: if these appear in the SERVED HTML, the tracker is hardcoded
// into the page/theme (fix = re-tag or move behind consent). If a tracker fires at
// runtime but is NOT in served HTML, it was injected later (fix = consent mode / GTM).
const INLINE_SIGS = [
  { name: 'Meta (Facebook) Pixel', re: /fbq\(|connect\.facebook\.net|fbevents/i },
  { name: 'Google Analytics / gtag', re: /gtag\s*\(|gtag\/js|google-analytics\.com/i },
  { name: 'Google Tag Manager', re: /googletagmanager\.com\/gtm\.js|['"]GTM-[A-Z0-9]+['"]/i },
  { name: 'Google Ads / DoubleClick', re: /googleadservices|googlesyndication|doubleclick/i },
  { name: 'LinkedIn Insight Tag', re: /_linkedin_partner_id|snap\.licdn\.com|li\.lms-analytics/i },
  { name: 'TikTok Pixel', re: /analytics\.tiktok\.com|ttq\./i },
  { name: 'Microsoft Advertising (UET)', re: /bat\.bing\.com|uetq/i },
  { name: 'Termly', re: /app\.termly\.io/i },
  { name: 'CookieYes', re: /cookieyes|cdn-cookieyes/i },
];

const url = normalizeUrl(process.argv[2] || '');
if (!url) { console.error('Usage: node cli/diagnose.mjs <url>'); process.exit(1); }

const browser = await chromium.launch({ headless: true });

// --- 1. served HTML (root-cause classification) ---
let servedHtml = '';
try {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; privacy-audit/0.1)' } });
  servedHtml = await res.text();
} catch (e) { console.error('served-HTML fetch failed:', e.message); }
const inlineHits = INLINE_SIGS.filter((s) => s.re.test(servedHtml)).map((s) => s.name);

// --- 2. dynamic scan (what actually fires) — reuse the engine ---
const scan = await scanOne(browser, url, { sendGPC: true, writeReports: false, respectRobots: true });
 if (scan.skipped) {
  console.error(`Skipped ${url} — ${scan.skippedReason}.`);
  await browser.close();
  process.exit(2);
}

// --- 3. broad legal-link capture (ground-truth the false positives) ---
const page = await browser.newPage();
let legalLinks = [];
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);
  legalLinks = await page.evaluate(() => {
    const re = /privacy|cookie|policy|terms|legal|choices|opt[\s-]?out|do not sell|gdpr|ccpa|consent/i;
    return Array.from(document.querySelectorAll('a'))
      .map((a) => ({ text: (a.textContent || '').trim().slice(0, 60), href: a.href }))
      .filter((l) => l.href && (re.test(l.text) || re.test(l.href)));
  });
} catch {}
const outDir = join('customers', hostOf(url));
await mkdir(outDir, { recursive: true });
try { await page.screenshot({ path: join(outDir, 'home.png'), fullPage: true }); } catch {}
await page.close();
await browser.close();

// --- 4. classify each fired tracker by load mechanism ---
const classified = scan.trackers.map((t) => {
  const inline = inlineHits.includes(t.name);
  const gtmPresent = inlineHits.includes('Google Tag Manager') || scan.trackers.some((x) => x.name.startsWith('Google Tag Manager'));
  let mechanism, fix;
  if (inline) { mechanism = 'hardcoded in served HTML'; fix = 'Re-tag the script (type="text/plain" + data-consent-category) or move it behind the consent gate.'; }
  else if (gtmPresent) { mechanism = 'injected at runtime (likely via Google Tag Manager)'; fix = 'Set Google Consent Mode v2 default=denied and gate this tag on consent in GTM.'; }
  else { mechanism = 'injected at runtime (source unknown)'; fix = 'Identify injector; gate behind consent (consent mode or re-tag).'; }
  return { ...t, mechanism, fix };
});

const diag = {
  url,
  scannedAt: new Date().toISOString(),
  cmps: scan.cmps,
  gpcSignaled: scan.sentGPC,
  gpcHonored: !(scan.sentGPC && scan.saleShareTrackers.length),
  inlineHardcoded: inlineHits,
  trackers: classified,
  saleShareCount: scan.saleShareTrackers.length,
  trackingCookies: scan.trackingCookies,
  legalLinks,
  regexFoundLinks: scan.foundLinks,
};
await writeFile(join(outDir, 'diagnostic.json'), JSON.stringify(diag, null, 2));

// --- console ---
const C = { b: '\x1b[1m', r: '\x1b[0m', red: '\x1b[31m', grn: '\x1b[32m', dim: '\x1b[2m', cyn: '\x1b[36m' };
console.log(`\n${C.b}${C.cyn}━━ DIAGNOSTIC: ${url} ━━${C.r}`);
console.log(`${C.b}Consent tools:${C.r} ${scan.cmps.map((c) => `${c.name}[${c.via}]`).join(', ') || 'none'}`);
console.log(`${C.b}GPC honored:${C.r} ${diag.gpcHonored ? C.grn + 'yes' + C.r : C.red + 'NO' + C.r}`);
console.log(`\n${C.b}Trackers firing pre-consent (and why):${C.r}`);
for (const t of classified) {
  const flag = t.saleShare ? C.red + 'SALE/SHARE' + C.r : C.dim + t.category + C.r;
  console.log(`  • ${t.name} [${flag}]`);
  console.log(`      ${C.dim}${t.mechanism}${C.r}`);
}
console.log(`\n${C.b}Tracking cookies set pre-consent:${C.r} ${scan.trackingCookies.map((c) => c.name).join(', ') || 'none'}`);
console.log(`\n${C.b}Legal links actually present on the page:${C.r}`);
if (legalLinks.length) for (const l of legalLinks) console.log(`  • "${l.text}" → ${l.href}`);
else console.log(`  ${C.red}(none found — confirms the missing-policy flag)${C.r}`);
console.log(`\n${C.dim}Wrote ${join(outDir, 'diagnostic.json')} + home.png${C.r}`);
