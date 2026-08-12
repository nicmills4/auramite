#!/usr/bin/env node
// Monitoring run — re-scan a site, diff against the last snapshot, flag NEW leaks.
// This is what the subscription sells: "we re-check and tell you when something changes."
// Exit code 1 when a new leak appeared (so cron can trigger an alert email).
//
// Usage: node cli/monitor.mjs <url>
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { scanOne, hostOf, normalizeUrl } from '../lib/scanner.mjs';
import { signalsOf, diffSignals } from '../lib/diff.mjs';

const arg = process.argv[2];
if (!arg) { console.error('Usage: node cli/monitor.mjs <url>'); process.exit(2); }
const url = normalizeUrl(arg);
const host = hostOf(url);
const snapPath = join('customers', host, 'monitor.json');

const browser = await chromium.launch();
const scan = await scanOne(browser, url, { sendGPC: true, writeReports: false });
await browser.close();

const curr = signalsOf(scan);
let prev = null;
try { prev = JSON.parse(await readFile(snapPath, 'utf8')); } catch { /* first run */ }

const { added, resolved } = diffSignals(prev?.signals || [], curr);

await mkdir(join('customers', host), { recursive: true });
await writeFile(snapPath, JSON.stringify({ host, url, scannedAt: new Date().toISOString(), verdict: scan.verdict, signals: curr }, null, 2));

const label = (s) => s.replace(/^finding:/, '').replace(/^share:/, 'shares → ').replace(/^replay:/, 'session-replay: ').replace(/^chat:/, 'chat: ').replace(/^vppa:.*/, 'video + Meta Pixel (VPPA)');

console.log(`\n${host} — ${scan.verdict}`);
if (!prev) {
  console.log(`First snapshot saved (${curr.length} signal${curr.length === 1 ? '' : 's'}). Future runs will diff against this.`);
} else if (!added.length && !resolved.length) {
  console.log('No change since last scan. ✅');
} else {
  if (added.length) { console.log(`\n🔴 NEW since last scan (${added.length}):`); added.forEach((s) => console.log(`   + ${label(s)}`)); }
  if (resolved.length) { console.log(`\n✅ Resolved since last scan (${resolved.length}):`); resolved.forEach((s) => console.log(`   - ${label(s)}`)); }
}
console.log(`\nSnapshot: ${snapPath}`);
process.exit(added.length ? 1 : 0);
