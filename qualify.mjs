#!/usr/bin/env node
// Stage 1 — qualify a domain list with Similarweb BEFORE scanning.
// Keeps only US, mid-to-large sites so you don't waste scans/outreach on foreign or
// tiny domains. This is the only API-quota-bound step.
//
// Usage:
//   node qualify.mjs <list.csv> [--min-visits 50000] [--min-us 0.4] [--concurrency 3] [--limit N]
//
// Input CSV: url per line (optional ';rank' 2nd field ignored here).
// Output: qualified.csv (urls only, ready for batch.mjs) + qualify-report.csv (full data).

import { readFile, writeFile } from 'node:fs/promises';
import { getAudience } from './lib/enrich.mjs';
import { normalizeUrl, hostOf } from './lib/scanner.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const minVisits = numFlag('--min-visits', 50000);
const minUS = floatFlag('--min-us', 0.4);
const concurrency = numFlag('--concurrency', 3);
const limit = numFlag('--limit', 100000);
function numFlag(n, d) { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : d; }
function floatFlag(n, d) { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? parseFloat(args[i + 1]) : d; }

if (!file) { console.error('Usage: node qualify.mjs <list.csv> [--min-visits N] [--min-us F] [--concurrency K] [--limit N]'); process.exit(1); }
if (!process.env.SIMILARWEB_API_KEY) { console.error('SIMILARWEB_API_KEY not set — run check-similarweb.mjs first.'); process.exit(1); }

const raw = await readFile(file, 'utf8');
const urls = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => normalizeUrl(l.split(/[;,]/)[0].trim())).filter(Boolean).slice(0, limit);

console.log(`Qualifying ${urls.length} domains  (keep: visits >= ${minVisits.toLocaleString()} AND %US >= ${Math.round(minUS * 100)}%)\n`);

const rows = new Array(urls.length);
let cursor = 0, done = 0;
async function worker() {
  while (cursor < urls.length) {
    const i = cursor++;
    const host = hostOf(urls[i]);
    const a = await getAudience(host).catch(() => ({ source: 'none' }));
    const visits = a.monthlyVisits ?? null;
    const us = a.pctUS ?? null;
    const keep = a.source === 'similarweb' && visits != null && visits >= minVisits && (us == null || us >= minUS);
    rows[i] = { url: urls[i], host, source: a.source, visits, us, keep };
    done++;
    if (done % 10 === 0 || done === urls.length) console.log(`  ...${done}/${urls.length}`);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));

const kept = rows.filter((r) => r.keep).sort((a, b) => (b.visits || 0) - (a.visits || 0));
const noData = rows.filter((r) => r.source !== 'similarweb');

await writeFile('qualified.csv', kept.map((r) => r.url).join('\n') + '\n');

const rep = [['url', 'monthly_visits', 'pct_us', 'source', 'decision']];
for (const r of rows.sort((a, b) => (b.visits || 0) - (a.visits || 0))) {
  rep.push([r.url, r.visits ?? '', r.us != null ? (r.us * 100).toFixed(1) + '%' : '', r.source, r.keep ? 'QUALIFIED' : 'drop'].join(','));
}
await writeFile('qualify-report.csv', rep.map((x) => Array.isArray(x) ? x.join(',') : x).join('\n'));

console.log(`\n━━ QUALIFIED ${kept.length}/${urls.length} ━━`);
console.log(`Dropped: ${urls.length - kept.length}  (${noData.length} had no Similarweb data)`);
console.log(`\nTop qualified:`);
kept.slice(0, 15).forEach((r, i) => console.log(`  ${i + 1}. ${r.host} — ${(r.visits || 0).toLocaleString()} visits/mo${r.us != null ? `, ${Math.round(r.us * 100)}% US` : ''}`));
console.log(`\nWrote qualified.csv (${kept.length} urls) + qualify-report.csv`);
console.log(`Next: node batch.mjs qualified.csv   (scans + scores only the survivors)`);
