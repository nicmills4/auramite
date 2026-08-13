#!/usr/bin/env node
// End-to-end LinkedIn outreach kit from an Apollo (or any) contact CSV.
// For each prospect scored CRITICAL/HIGH: writes customers/<host>/proof.html + proof.png,
// and assembles outreach-sheet.md with a filled connection note + first message.
//
// Usage: node cli/outreach.mjs <contacts.csv> [--min-score 45] [--concurrency 5]

import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scanOne, hostOf } from '../lib/scanner.mjs';
import { scoreRisk } from '../lib/risk.mjs';
import { loadTargets } from '../lib/loader.mjs';
import { renderProofPage } from '../lib/proofpage.mjs';
import { outreachHook } from '../lib/explainers.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const minScore = numFlag('--min-score', 45);  // HIGH+ by default
const concurrency = numFlag('--concurrency', 5);
function numFlag(n, d) { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : d; }
if (!file) { console.error('Usage: node cli/outreach.mjs <contacts.csv> [--min-score N]'); process.exit(1); }

const targets = await loadTargets(file);
console.log(`Loaded ${targets.length} contacts. Scanning + scoring...\n`);

const browser = await chromium.launch();

// --- scan + score (pool) ---
const scored = new Array(targets.length);
let cursor = 0, done = 0;
async function worker() {
  while (cursor < targets.length) {
    const i = cursor++; const t = targets[i];
    try {
      const scan = await scanOne(browser, t.url, { sendGPC: true, writeReports: false, respectRobots: true });
      if (scan.skipped) {
        // Scored 0 so it falls below minScore and never reaches the outreach
        // sheet: a site whose robots.txt turned us away must not be contacted
        // about findings we never made.
        scored[i] = { t, scan, risk: { score: 0, band: 'SKIPPED', exposures: [scan.skippedReason] }, skipped: true };
      } else {
        const audience = (t.employees != null || t.revenue != null)
          ? { source: 'firmographic', employees: t.employees, revenue: t.revenue, country: t.country } : { source: 'none' };
        const risk = scoreRisk(scan, audience);
        scored[i] = { t, scan, risk };
      }
    } catch (e) { scored[i] = { t, scan: {}, risk: { score: 0, band: 'FAILED' }, error: String(e.message || e) }; }
    console.log(`  [${++done}/${targets.length}] ${hostOf(t.url)} — ${scored[i].risk.band} ${scored[i].risk.score || 0}`);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));

// --- flagged, ranked ---
const flagged = scored.filter((s) => (s.risk.score || 0) >= minScore).sort((a, b) => b.risk.score - a.risk.score);
console.log(`\n${flagged.length} prospect(s) at/above score ${minScore}. Generating proof pages + screenshots...`);

const firstName = (full) => (full || '').trim().split(/\s+/)[0] || 'there';
function connectionNote(first, company, industry, hook) {
  const ind = industry ? industry : 'companies in your space';
  let n = `Hi ${first} — I run website privacy scans for ${ind}. Did a quick one on ${company} and noticed your site ${hook.short} before visitors consent — worth flagging to your team. Mind if I connect?`;
  if (n.length > 300) n = `Hi ${first} — I run website privacy scans and did a quick one on ${company}. Noticed something on your site worth flagging to your team. Mind if I connect?`;
  if (n.length > 300) n = `Hi ${first} — ran a quick privacy scan on ${company}'s site and found something worth flagging. Mind if I connect?`;
  return n;
}
const firstMessage = (first, company, hook) =>
  `Thanks for connecting, ${first}. Quick heads-up, not a pitch: when I loaded ${company}'s site, ${hook.line}. I put together a one-page breakdown of what's happening on your specific site, with the receipts — want me to send it over? (You can also confirm it yourself in ~30 seconds; happy to show you how.)`;

const sheet = [`# LinkedIn outreach sheet — ${flagged.length} prospects (score ≥ ${minScore})`, '',
  `Work top-down. Send ~15–25 connection requests/day, manually, no automation. Send the proof image only after they accept and show interest.`, ''];

const page = await browser.newPage({ viewport: { width: 760, height: 1400 } });
for (const s of flagged) {
  const host = hostOf(s.t.url);
  const dir = join('customers', host);
  await mkdir(dir, { recursive: true });
  const { html } = renderProofPage(s.scan, host);
  await writeFile(join(dir, 'proof.html'), html);
  try {
    await page.goto(pathToFileURL(resolve(dir, 'proof.html')).href, { waitUntil: 'networkidle', timeout: 30000 });
    await page.screenshot({ path: join(dir, 'proof.png'), fullPage: true });
  } catch (e) { console.log(`   (screenshot failed for ${host}: ${e.message})`); }

  const hook = outreachHook(s.scan);
  const first = firstName(s.t.contactName);
  sheet.push(`## ${s.risk.score} ${s.risk.band} — ${s.t.company || host}`);
  sheet.push(`- **Contact:** ${s.t.contactName || '(none)'}${s.t.title ? `, ${s.t.title}` : ''}${s.t.email ? ` · ${s.t.email}` : ''}`);
  sheet.push(`- **Site:** ${s.t.url} · **Industry:** ${s.t.industry || '?'} · **Top exposure:** ${hook.theory}`);
  sheet.push(`- **Proof image:** ${join(dir, 'proof.png')}`);
  sheet.push('', `**Connection note** (${connectionNote(first, s.t.company || host, s.t.industry, hook).length} chars):`, `> ${connectionNote(first, s.t.company || host, s.t.industry, hook)}`);
  sheet.push('', `**First message (after accept):**`, `> ${firstMessage(first, s.t.company || host, hook)}`, '', '---', '');
}
await browser.close();

await writeFile('outreach-sheet.md', sheet.join('\n'));
console.log(`\n✓ Wrote outreach-sheet.md (${flagged.length} prospects) + proof.png per prospect under customers/.`);
console.log(`Open outreach-sheet.md and work top-down on LinkedIn.`);
