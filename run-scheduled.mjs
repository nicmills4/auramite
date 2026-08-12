#!/usr/bin/env node
// Scheduled batch orchestrator — the automated service.
// Reads a whitelist, scans each site that's DUE per its cadence, diffs against the
// last snapshot to detect NEW leaks, renders the proof page, emails each owner their
// report, and emails you a run summary. Designed to run on a cron (or a Cloud Run Job).
//
// Usage: node run-scheduled.mjs [whitelist.json] [--force]
//   --force  scan every site regardless of cadence (for testing)
//
// Swap points for production: lib/store.mjs (→ Postgres) and lib/notify.mjs (→ Resend).

import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { scanOne, hostOf, normalizeUrl } from './lib/scanner.mjs';
import { scoreRisk } from './lib/risk.mjs';
import { buildExplainers } from './lib/explainers.mjs';
import { renderProofPage } from './lib/proofpage.mjs';
import { signalsOf, diffSignals } from './lib/diff.mjs';
import { getState, saveState } from './lib/store.mjs';
import { sendReport, sendSummary } from './lib/notify.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const listPath = args.find((a) => !a.startsWith('--')) || 'whitelist.json';
const CONCURRENCY = 4;
const CADENCE_MS = { daily: 24 * 3600e3, weekly: 7 * 24 * 3600e3 };
const now = Date.now();

const wl = JSON.parse(await readFile(listPath, 'utf8'));
const operatorEmail = process.env.OPERATOR_EMAIL || wl.operatorEmail || 'you@example.com';
const sites = (wl.sites || wl).map((s) => (typeof s === 'string' ? { url: s } : s));

function isDue(state, cadence) {
  if (force || !state?.lastScannedAt) return true;
  const iv = CADENCE_MS[cadence] || CADENCE_MS.weekly;
  return now - new Date(state.lastScannedAt).getTime() >= iv - 3600e3; // 1h grace
}

// Resolve which sites are due
const targets = [];
for (const s of sites) {
  const url = normalizeUrl(s.url);
  const host = hostOf(url);
  const state = await getState(host);
  if (isDue(state, s.cadence)) targets.push({ ...s, url, host, state });
}

console.log(`Whitelist: ${sites.length} site(s) · due now: ${targets.length}${force ? ' (forced)' : ''}`);
if (!targets.length) { console.log('Nothing due. Exiting.'); process.exit(0); }

const browser = await chromium.launch();
const results = new Array(targets.length);
let cursor = 0, done = 0;

async function worker() {
  while (cursor < targets.length) {
    const i = cursor++;
    const t = targets[i];
    try {
      const scan = await scanOne(browser, t.url, { sendGPC: true, writeReports: false });
      const risk = scoreRisk(scan, { source: 'none' });
      const explainers = buildExplainers(scan);
      const signals = signalsOf(scan);
      const firstRun = !(t.state && t.state.signals);
      const diff = firstRun ? { added: [], resolved: [] } : diffSignals(t.state.signals, signals);

      await saveState(t.host, { host: t.host, url: t.url, lastScannedAt: new Date(now).toISOString(), lastVerdict: scan.verdict, signals });

      const dir = join('customers', t.host);
      await mkdir(dir, { recursive: true });
      const { html } = renderProofPage(scan, t.host);
      await writeFile(join(dir, 'proof.html'), html);

      await sendReport({ to: t.ownerEmail, host: t.host, scan, explainers, diff, firstRun });

      results[i] = { host: t.host, verdict: scan.verdict, score: risk.score, band: risk.band, added: diff.added, resolved: diff.resolved, firstRun };
    } catch (e) {
      results[i] = { host: t.host, error: String(e.message || e) };
    }
    done++;
    const r = results[i];
    const tag = r.error ? 'FAILED' : `${r.band} ${r.score}${!r.firstRun && r.added?.length ? ` · 🔴 ${r.added.length} NEW` : r.firstRun ? ' · baseline' : ''}`;
    console.log(`  [${done}/${targets.length}] ${r.host} — ${tag}`);
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
await browser.close();

await sendSummary({ to: operatorEmail, results, ranAt: new Date(now).toISOString() });

const newLeaks = results.filter((r) => !r.error && !r.firstRun && r.added?.length);
console.log(`\n━━ RUN COMPLETE ━━`);
console.log(`Scanned ${results.length} · new leaks on ${newLeaks.length} site(s) · summary → ${operatorEmail}`);
newLeaks.forEach((r) => console.log(`  🔴 ${r.host}: +${r.added.length}`));
console.log(`Messages written to data/outbox/ (wire lib/notify.mjs → Resend to actually send).`);
