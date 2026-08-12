#!/usr/bin/env node
// Generate a standalone, send-ready proof page for one site.
// Usage: node cli/report.mjs <url>
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { scanOne, hostOf, normalizeUrl } from '../lib/scanner.mjs';
import { renderProofPage } from '../lib/proofpage.mjs';

const arg = process.argv[2];
if (!arg) { console.error('Usage: node cli/report.mjs <url>'); process.exit(1); }
const url = normalizeUrl(arg);

const browser = await chromium.launch();
const scan = await scanOne(browser, url, { sendGPC: true, writeReports: false });
await browser.close();

const host = hostOf(url);
const { html, explainers, firstShareMs, bannerMs } = renderProofPage(scan, host);

const dir = join('customers', host);
await mkdir(dir, { recursive: true });
await writeFile(join(dir, 'proof.html'), html);
await writeFile(join(dir, 'proof.json'), JSON.stringify({
  url, host, scannedAt: new Date().toISOString(), verdict: scan.verdict,
  bannerMs, firstShareMs, hardShare: (scan.hardSaleShare || []).map((t) => t.name),
  violations: explainers.map((e) => ({ key: e.key, severity: e.severity, title: e.title })),
}, null, 2));

console.log(`\n✓ ${host}: ${explainers.length} violation${explainers.length === 1 ? '' : 's'} explained — ${scan.verdict}`);
for (const e of explainers) console.log(`   • [${e.severity}] ${e.title}`);
console.log(`\nWrote ${join(dir, 'proof.html')}`);
