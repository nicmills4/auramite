// Litigation-exposure scorer.
//
// Converts a scan result + audience data into a 0-100 exposure score, the legal
// theories in play, and a band. The model mirrors the 2025 enforcement reality:
//   - CIPA (private, $5k/violation, >1,000 suits in 2025): session replay, chat,
//     Meta Pixel — keyed to CA audience.
//   - VPPA (private, $2,500/violation): video + Meta Pixel.
//   - CCPA/CPPA (regulator fines: Tractor Supply $1.35M, Healthline $1.55M):
//     identifiers shared pre-consent + ignored GPC + broken opt-out.
// Audience scales the score because litigation/threshold risk concentrates in sites
// with real US/CA traffic; micro-sites are filtered down, not up.

import { INDUSTRY_KEYWORDS } from './signatures.mjs';
import { hostOf } from './scanner.mjs';

export function detectIndustry(scan) {
  const blob = [scan.pageMeta?.title, scan.pageMeta?.desc, scan.pageMeta?.h1, scan.url].filter(Boolean).join(' ');
  for (const [name, re] of Object.entries(INDUSTRY_KEYWORDS)) if (re.test(blob)) return name;
  return null;
}

// Scope = entity-type exemption (from TLD) × geography (real %US when known, else TLD).
// US-state privacy laws largely don't reach exempt/foreign entities, so they're
// deprioritized (not deleted — the tech finding is still real).
const FOREIGN_TLD = /\.(uk|za|hu|br|fi|de|fr|es|it|nl|be|se|no|dk|ch|at|ie|gr|pl|au|nz|jp|kr|in|mx|ar|cl|pt|cz|ro|sk|hr|ru|ua)$/i;
export function scopeOf(url, audience) {
  const h = hostOf(url);
  let entity = { flag: '', f: 1 };
  if (/\.gov$|\.mil$/.test(h)) entity = { flag: 'government (exempt)', f: 0.2 };
  else if (/\.edu$|\.ac\.[a-z]{2}$/.test(h)) entity = { flag: 'education (often exempt)', f: 0.3 };
  else if (/\.org$/.test(h)) entity = { flag: 'possible nonprofit (verify)', f: 0.8 };

  let geo = { flag: '', f: 1 };
  const country = (audience?.country || '').toLowerCase();
  const us = audience?.pctUS;
  if (country) {
    const isUS = /united states|^us$|^usa$|u\.s\.|america/.test(country);
    geo = isUS ? { flag: 'US (firmographic)', f: 1 } : { flag: `${audience.country} (foreign)`, f: 0.3 };
  } else if (us != null) {
    if (us >= 0.5) geo = { flag: `${Math.round(us * 100)}% US`, f: 1 };
    else if (us >= 0.25) geo = { flag: `${Math.round(us * 100)}% US (mixed)`, f: 0.7 };
    else geo = { flag: `${Math.round(us * 100)}% US (foreign-leaning)`, f: 0.35 };
  } else if (FOREIGN_TLD.test(h) || /\.co\.[a-z]{2}$|\.com\.[a-z]{2}$/.test(h)) {
    geo = { flag: 'foreign TLD', f: 0.35 };
  } else {
    geo = { flag: 'US? (no geo data)', f: 1 };
  }

  const flag = [entity.flag, geo.flag].filter(Boolean).join(', ') || 'likely US-commercial';
  return { flag, factor: entity.f * geo.f };
}

// audience: { source, monthlyVisits?, pctUS?, pctCA?, popularityRank?, employees?, revenue? }
function audienceScore(a) {
  if (!a || a.source === 'none') return { pts: 0, label: 'unknown', note: 'no size data (firmographics, traffic, or rank)' };
  // Firmographic size (Apollo/ZoomInfo export) — bigger = more exposure + more covered.
  if (a.revenue != null || a.employees != null) {
    let pts = 0, label = '';
    if (a.revenue != null) { pts = a.revenue >= 1e9 ? 30 : a.revenue >= 1e8 ? 26 : a.revenue >= 25e6 ? 22 : a.revenue >= 10e6 ? 16 : a.revenue >= 1e6 ? 9 : 4; label = `$${fmt(a.revenue)} rev`; }
    if (a.employees != null) { const e = a.employees >= 1000 ? 30 : a.employees >= 500 ? 27 : a.employees >= 200 ? 23 : a.employees >= 100 ? 18 : a.employees >= 50 ? 13 : a.employees >= 20 ? 8 : 4; pts = Math.max(pts, e); label = label ? `${label}, ${a.employees} emp` : `${a.employees} emp`; }
    return { pts, label, note: a.source };
  }
  if (a.monthlyVisits != null) {
    const v = a.monthlyVisits;
    let base = v >= 5e6 ? 30 : v >= 1e6 ? 26 : v >= 250e3 ? 20 : v >= 50e3 ? 12 : v >= 10e3 ? 6 : 2;
    // CA share is the CIPA trigger — boost when known and meaningful
    if (a.pctCA != null && a.pctCA >= 0.08) base = Math.min(30, base + 4);
    return { pts: base, label: `${fmt(v)} visits/mo${a.pctUS != null ? `, ${Math.round(a.pctUS * 100)}% US` : ''}`, note: a.source };
  }
  if (a.popularityRank != null) {
    const r = a.popularityRank;
    const pts = r <= 50e3 ? 28 : r <= 150e3 ? 22 : r <= 400e3 ? 16 : r <= 1e6 ? 9 : 4;
    return { pts, label: `popularity rank ~${fmt(r)}`, note: a.source + ' (rank proxy, not US/CA traffic)' };
  }
  return { pts: 0, label: 'unknown', note: a.source };
}

function fmt(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n); }

export function scoreRisk(scan, audience) {
  const exposures = [];
  let tech = 0;

  if (scan.sessionRecorders?.length) { tech += 20; exposures.push(`CIPA — session replay (${scan.sessionRecorders.map((t) => t.name).join(', ')})`); }
  if (scan.hasVideo && scan.hasMetaPixel) { tech += 20; exposures.push('VPPA — video + Meta Pixel'); }
  if (scan.hasMetaPixel) { tech += 12; exposures.push('CIPA/wiretap — Meta Pixel firing pre-consent'); }
  if (scan.hasChat) { tech += 10; exposures.push(`CIPA — chat widget (${scan.chats.map((c) => c.name).join(', ')})`); }
  if (scan.hardSaleShare?.length) { tech += 10; exposures.push(`CCPA/CPPA — identifiers shared pre-consent (${scan.hardSaleShare.map((t) => t.name).join(', ')})`); }
  if (scan.gpcIgnoredHard) { tech += 10; exposures.push('CCPA/CPPA — GPC not honored (Tractor Supply pattern)'); }
  if (scan.optOutMissingWhileSharing) { tech += 6; exposures.push('CCPA/CPPA — no working opt-out while sharing'); }
  tech = Math.min(tech, 60);

  const aud = audienceScore(audience);
  const industry = detectIndustry(scan);
  const scope = scopeOf(scan.url || '', audience);

  // Audience + industry only count when a violation mechanism exists — popularity or
  // vertical alone is not litigation exposure. No tech finding => LOW, full stop.
  const indPts = tech > 0 && industry ? 10 : 0;
  const audPts = tech > 0 ? aud.pts : 0;
  if (tech > 0 && industry) exposures.push(`High-risk vertical (${industry}) — regulator + plaintiff magnet`);

  const rawScore = tech === 0 ? 0 : Math.min(100, tech + audPts + indPts);
  const score = Math.round(rawScore * scope.factor); // deprioritize out-of-US-scope
  const band = score >= 70 ? 'CRITICAL' : score >= 45 ? 'HIGH' : score >= 25 ? 'MODERATE' : 'LOW';

  return {
    score, band, exposures, industry, scope: scope.flag,
    breakdown: { tech, audience: audPts, industry: indPts, scopeFactor: scope.factor },
    audienceLabel: aud.label, audienceNote: aud.note, audienceSource: audience?.source || 'none',
  };
}
