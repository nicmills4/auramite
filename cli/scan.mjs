#!/usr/bin/env node
// Privacy audit scanner — single/few-URL CLI.
//
// Usage:
//   node cli/scan.mjs <url> [url2 ...]
//   node cli/scan.mjs --no-gpc <url>     # run without the GPC signal (to compare)
//
// For a CSV of many domains, use batch.mjs instead.

import { chromium } from 'playwright';
import { scanOne, renderConsole, normalizeUrl } from '../lib/scanner.mjs';

const rawArgs = process.argv.slice(2);
const sendGPC = !rawArgs.includes('--no-gpc');
const urls = rawArgs.filter((a) => !a.startsWith('--')).map(normalizeUrl);

if (urls.length === 0) {
  console.error('Usage: node cli/scan.mjs <url> [url2 ...] [--no-gpc]');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const summary = [];
for (const url of urls) {
  try {
    const r = await scanOne(browser, url, { sendGPC });
    renderConsole(r);
    summary.push({ url, verdict: r.verdict, cmps: r.cmps.map((c) => c.name) });
  } catch (e) {
    console.error(`\n✗ ${url} — scan failed: ${e.message || e}`);
    summary.push({ url, verdict: 'SCAN FAILED' });
  }
}
await browser.close();

if (summary.length > 1) {
  console.log('\n\x1b[1m━━ Summary ━━\x1b[0m');
  for (const s of summary) console.log(`  ${s.verdict.startsWith('LIKELY') ? '🔴' : s.verdict.startsWith('POSSIBLE') ? '🟠' : s.verdict.startsWith('NO') ? '✅' : '⚠️'}  ${s.url} — ${s.verdict}`);
}
console.log('\nReports + screenshots saved under ./reports/');
