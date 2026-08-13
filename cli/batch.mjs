#!/usr/bin/env node
// Batch scanner + litigation-exposure scorer.
//
// Usage:
//   node cli/batch.mjs <file.csv> [--limit N] [--concurrency K] [--no-gpc]
//
// CSV: one URL per line; an optional 2nd field after ';' or ',' is treated as a
// popularity rank (PublicWWW exports this). Set SIMILARWEB_API_KEY for real traffic.

import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { scanOne, hostOf, stamp } from '../lib/scanner.mjs';
import { getAudience } from '../lib/enrich.mjs';
import { scoreRisk } from '../lib/risk.mjs';
import { loadTargets } from '../lib/loader.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const limit = numFlag('--limit', 50);
const concurrency = numFlag('--concurrency', 4);
const sendGPC = !args.includes('--no-gpc');
function numFlag(name, def) { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : def; }

if (!file) { console.error('Usage: node cli/batch.mjs <file.csv> [--limit N] [--concurrency K] [--no-gpc]'); process.exit(1); }

// --- load targets: bare URL list OR rich B2B export (Apollo/ZoomInfo/Data Axle) ---
const rows = (await loadTargets(file)).slice(0, limit);
const rich = rows.some((r) => r.employees != null || r.revenue != null || r.company);
console.log(`Scanning + scoring ${rows.length} sites (concurrency ${concurrency}, GPC ${sendGPC ? 'on' : 'off'}, size signal: ${rich ? 'firmographic (CSV)' : process.env.SIMILARWEB_API_KEY ? 'Similarweb' : 'rank-proxy'})...\n`);

// Build the audience object for a target: prefer firmographics from the export.
async function audienceFor(t) {
  if (t.employees != null || t.revenue != null) return { source: 'firmographic', employees: t.employees, revenue: t.revenue, country: t.country };
  const a = await getAudience(hostOf(t.url), { rank: t.rank });
  if (t.country) a.country = t.country;
  return a;
}

const browser = await chromium.launch({ headless: true });
const results = new Array(rows.length);
let done = 0, cursor = 0;

async function worker() {
  while (cursor < rows.length) {
    const i = cursor++;
    const t = rows[i];
    try {
      const scan = await scanOne(browser, t.url, { sendGPC, respectRobots: true });
      if (scan.skipped) {
        // Must not fall through to scoreRisk: an unscanned site would score 0
        // and read as "no exposure", which is the opposite of what we know.
        results[i] = { url: t.url, target: t, scan, skipped: true, risk: { score: 0, band: 'SKIPPED', exposures: [scan.skippedReason] } };
      } else {
        const audience = await audienceFor(t);
        const risk = scoreRisk(scan, audience);
        results[i] = { scan, risk, url: t.url, target: t };
      }
    } catch (e) {
      results[i] = { url: t.url, target: t, error: String(e.message || e), risk: { score: 0, band: 'FAILED', exposures: [] }, scan: {} };
    }
    done++;
    const r = results[i];
    console.log(`[${String(done).padStart(2)}/${rows.length}] ${bandTag(r.risk.band)} ${String(r.risk.score).padStart(3)}  ${(t.company || hostOf(t.url)).slice(0, 28).padEnd(28)} ${r.risk.exposures?.[0] || (r.error ? 'scan failed' : 'no exposure')}`);
  }
}
function bandTag(b) { return b === 'CRITICAL' ? '🔴CRIT' : b === 'HIGH' ? '🟠HIGH' : b === 'MODERATE' ? '🟡MOD ' : b === 'FAILED' ? '⚠️FAIL' : '🟢LOW '; }

await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
await browser.close();

// --- rank by exposure score ---
const ranked = results.slice().sort((a, b) => (b.risk.score || 0) - (a.risk.score || 0));

// --- aggregate ---
const outDir = join('reports', `_exposure-${stamp()}`);
await mkdir(outDir, { recursive: true });

const header = ['rank', 'company', 'url', 'contact', 'email', 'title', 'exposure_score', 'band', 'scope', 'size', 'industry', 'meta_pixel', 'session_replay', 'chat', 'video_pixel_vppa', 'hard_share', 'gpc_ignored', 'legal_theories'];
const csv = [header.join(',')];
ranked.forEach((r, i) => {
  const s = r.scan || {}, t = r.target || {};
  csv.push([
    i + 1, t.company || '', r.url, t.contactName || '', t.email || '', t.title || '',
    r.risk.score, r.risk.band, r.risk.scope || '', r.risk.audienceLabel || '', t.industry || r.risk.industry || '',
    s.hasMetaPixel ? 'yes' : '', s.sessionRecorders?.length ? s.sessionRecorders.map((t) => t.name).join('|') : '',
    s.hasChat ? s.chats.map((c) => c.name).join('|') : '', s.hasVideo && s.hasMetaPixel ? 'yes' : '',
    s.hardSaleShare?.length ? s.hardSaleShare.map((t) => t.name).join('|') : '', s.gpcIgnoredHard ? 'yes' : '',
    (r.risk.exposures || []).join(' ; '),
  ].map(csvCell).join(','));
});
await writeFile(join(outDir, 'exposure.csv'), csv.join('\n'));
function csvCell(v) { const x = String(v ?? ''); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }

const md = [];
md.push(`# Litigation-exposure ranking — ${rows.length} sites`, '');
md.push(`Source: \`${file}\` · GPC: ${sendGPC ? 'on' : 'off'} · traffic: ${process.env.SIMILARWEB_API_KEY ? 'Similarweb' : 'popularity-rank proxy'}`, '');
const crit = ranked.filter((r) => r.risk.band === 'CRITICAL').length;
const high = ranked.filter((r) => r.risk.band === 'HIGH').length;
md.push(`**${crit} CRITICAL · ${high} HIGH** out of ${rows.length}. Work the top of this list; ignore LOW (under-threshold / not worth suing).`, '');
md.push('| # | Score | Band | Company | Site | Size | Contact | Top legal exposures |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
ranked.forEach((r, i) => {
  const t = r.target || {};
  md.push(`| ${i + 1} | ${r.risk.score} | ${r.risk.band} | ${t.company || '-'} | ${hostOf(r.url)} | ${r.risk.audienceLabel || '?'} | ${t.contactName || ''}${t.email ? ' <' + t.email + '>' : ''} | ${(r.risk.exposures || []).slice(0, 3).join('; ') || '-'} |`);
});
md.push('', `Full data: \`${join(outDir, 'exposure.csv')}\`. Per-site evidence under \`reports/<host>-*/\`.`);
md.push('', `> Score = tech-risk (≤60: session-replay/Meta-Pixel/video-VPPA/chat/hard-share/GPC) + audience (≤30) + industry (≤10). Audience is a ${process.env.SIMILARWEB_API_KEY ? 'real-traffic' : 'rank proxy — wire SIMILARWEB_API_KEY for US/CA traffic'} input.`);
await writeFile(join(outDir, 'exposure.md'), md.join('\n'));

// --- needs-traffic template: only sites WITH exposure that lack real traffic data ---
const needs = ranked.filter((r) => (r.risk.breakdown?.tech || 0) > 0 && !['similarweb', 'manual-dashboard', 'firmographic'].includes(r.risk.audienceSource));
if (needs.length) {
  const tmpl = ['# Fill visits + pct_us from the Similarweb dashboard, then save as manual-traffic.csv in the project root and re-run batch.', 'host,visits,pct_us'];
  for (const r of needs) tmpl.push(`${hostOf(r.url)},,`);
  await writeFile(join(outDir, 'needs-traffic.csv'), tmpl.join('\n') + '\n');
}

// --- console summary ---
const C = { b: '\x1b[1m', r: '\x1b[0m', red: '\x1b[31m', dim: '\x1b[2m' };
console.log(`\n${C.b}━━━━━━ EXPOSURE RANKING ━━━━━━${C.r}`);
console.log(`${C.red}${crit} CRITICAL${C.r} · ${high} HIGH · of ${rows.length} scanned`);
console.log(`\n${C.b}Top targets:${C.r}`);
ranked.slice(0, 12).forEach((r, i) => {
  if (r.risk.band === 'LOW' || r.risk.band === 'FAILED') return;
  console.log(`  ${String(i + 1).padStart(2)}. [${String(r.risk.score).padStart(3)} ${r.risk.band}] ${hostOf(r.url)} ${C.dim}(${r.risk.scope}) — ${(r.risk.exposures || [])[0] || ''}${C.r}`);
});
console.log(`\n${C.b}Report:${C.r} ${join(outDir, 'exposure.md')} · ${join(outDir, 'exposure.csv')}`);
if (needs.length) console.log(`${C.b}Next:${C.r} fill ${join(outDir, 'needs-traffic.csv')} (${needs.length} sites) from the Similarweb dashboard → save as manual-traffic.csv in project root → re-run for real-traffic scoring.`);
