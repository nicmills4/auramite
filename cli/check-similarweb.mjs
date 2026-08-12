#!/usr/bin/env node
// Verify Similarweb API access BEFORE spending trial quota on the whole list.
// Usage: node cli/check-similarweb.mjs [domain]
import { fetchSimilarweb } from '../lib/enrich.mjs';

const domain = process.argv[2] || 'nytimes.com';
const key = process.env.SIMILARWEB_API_KEY;
if (!key) {
  console.error('SIMILARWEB_API_KEY is not set in this shell. Set it, then re-run.');
  process.exit(1);
}

console.log(`Testing Similarweb API for "${domain}" (key ...${key.slice(-4)})\n`);
const sw = await fetchSimilarweb(domain, key);

console.log(`month requested: ${sw.month}`);
console.log(`visits endpoint -> HTTP ${sw.status.visits}`);
console.log(`geo endpoint    -> HTTP ${sw.status.geo}\n`);

if (sw.status.visits === 401 || sw.status.visits === 403) {
  console.log('❌ 401/403 = your key/plan does NOT have API access (dashboard-only is common).');
  console.log('   -> We pivot to the dashboard-qualify workflow instead. Tell me and I will adjust.');
} else if (sw.status.visits === 200) {
  const series = sw.visits?.visits;
  const v = Array.isArray(series) && series.length ? series[series.length - 1].visits : null;
  console.log(`✅ API works. Latest monthly visits: ${v != null ? Math.round(v).toLocaleString() : 'n/a (see raw below)'}`);
}

console.log('\n--- raw visits (first 1200 chars) ---');
console.log(JSON.stringify(sw.visits, null, 2).slice(0, 1200));
console.log('\n--- raw geo (first 1200 chars) ---');
console.log(JSON.stringify(sw.geo, null, 2).slice(0, 1200));
