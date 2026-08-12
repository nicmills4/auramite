// Traffic / audience enrichment.
//
// Priority:
//   1. manual-traffic.csv  (numbers you read off the Similarweb DASHBOARD) — host,visits,pct_us
//   2. Similarweb API       (if SIMILARWEB_API_KEY set — most plans are dashboard-only)
//   3. popularity rank       (from the input CSV)
//   4. nothing               (never fabricated)

import { readFileSync, existsSync } from 'node:fs';

const API = 'https://api.similarweb.com/v1/website';

function recentMonth() {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 2);
  return d.toISOString().slice(0, 7);
}

// --- manual dashboard override -------------------------------------------
let manualMap = null;
function loadManual() {
  if (manualMap) return manualMap;
  manualMap = new Map();
  try {
    if (existsSync('manual-traffic.csv')) {
      const text = readFileSync('manual-traffic.csv', 'utf8');
      for (const line of text.split(/\r?\n/).slice(1)) {
        if (!line.trim() || line.startsWith('#')) continue;
        const [host, visits, pus] = line.split(',').map((s) => (s || '').trim());
        if (!host) continue;
        const v = parseInt(String(visits).replace(/[^0-9]/g, ''), 10);
        let u = null;
        if (pus) { const isPct = pus.includes('%') || parseFloat(pus) > 1; u = parseFloat(pus.replace('%', '')) / (isPct ? 100 : 1); }
        manualMap.set(host.replace(/^www\./, ''), { monthlyVisits: Number.isFinite(v) ? v : null, pctUS: Number.isFinite(u) ? u : null });
      }
    }
  } catch { /* ignore */ }
  return manualMap;
}

export async function fetchSimilarweb(domain, key, month = recentMonth()) {
  const visitsUrl = `${API}/${encodeURIComponent(domain)}/total-traffic-and-engagement/visits?api_key=${key}&start_date=${month}&end_date=${month}&country=world&granularity=monthly&main_domain_only=true&format=json`;
  const geoUrl = `${API}/${encodeURIComponent(domain)}/geo/traffic-by-country?api_key=${key}&start_date=${month}&end_date=${month}&format=json`;
  const out = { month, status: {}, visits: null, geo: null };
  for (const [k, u] of [['visits', visitsUrl], ['geo', geoUrl]]) {
    try { const r = await fetch(u); out.status[k] = r.status; out[k] = await r.json().catch(() => null); }
    catch (e) { out.status[k] = 'ERR'; out[k] = { error: String(e.message || e) }; }
  }
  return out;
}

export async function getAudience(domain, { rank } = {}) {
  const host = domain.replace(/^www\./, '');

  const man = loadManual().get(host);
  if (man && man.monthlyVisits != null) return { source: 'manual-dashboard', monthlyVisits: man.monthlyVisits, pctUS: man.pctUS, pctCA: null };

  const key = process.env.SIMILARWEB_API_KEY;
  if (key) {
    try {
      const sw = await fetchSimilarweb(host, key);
      const series = sw.visits?.visits;
      const monthlyVisits = Array.isArray(series) && series.length ? Math.round(series[series.length - 1].visits) : null;
      if (monthlyVisits != null) {
        let pctUS = null;
        const recs = sw.geo?.records;
        if (Array.isArray(recs)) { const us = recs.find((x) => x.country === 840 || x.country_code === 'US' || x.country === 'US'); if (us) pctUS = us.share ?? us.value ?? null; }
        return { source: 'similarweb', monthlyVisits, pctUS, pctCA: null };
      }
    } catch { /* fall through */ }
  }

  if (rank != null && Number.isFinite(rank)) return { source: 'input-rank', popularityRank: rank };
  return { source: 'none' };
}
