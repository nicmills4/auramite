// Target-list loader. Ingests either a bare URL list OR a rich B2B export
// (Apollo / ZoomInfo / Data Axle) — auto-detecting the website, company, size,
// industry and contact columns. Firmographics (employees/revenue) become the size
// signal, so no Similarweb is needed.

import { readFile } from 'node:fs/promises';
import { normalizeUrl } from './scanner.mjs';

// Minimal RFC-4180-ish CSV parser (handles quotes, commas + newlines in quotes).
export function parseCSV(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const COLS = {
  website: [/^website$/, /company.*website/, /^domain$/, /company.*domain/, /^url$/, /web ?site/],
  company: [/^company$/, /company name/, /account name/, /^organization$/, /^account$/],
  employees: [/employees/, /head ?count/, /employee count/, /company size/, /# ?emp/, /staff/],
  revenue: [/revenue/, /annual revenue/, /sales volume/],
  industry: [/industry/, /sector/, /vertical/],
  country: [/^country$/, /company country/, /hq country/],
  state: [/^state$/, /company state/, /region/],
  email: [/^email$/, /work email/, /contact email/, /email address/],
  firstName: [/first name/, /^first$/],
  lastName: [/last name/, /^last$/],
  fullName: [/^name$/, /full name/, /contact name/],
  title: [/^title$/, /job title/, /position/],
};

function mapColumns(headers) {
  const h = headers.map((x) => (x || '').toLowerCase().trim());
  const map = {};
  for (const [key, pats] of Object.entries(COLS)) {
    map[key] = h.findIndex((col) => pats.some((p) => p.test(col)));
  }
  return map;
}

function toOrigin(website) {
  try { return new URL(normalizeUrl(website.trim())).origin; } catch { return null; }
}

export function parseEmployees(s) {
  if (!s) return null;
  const nums = String(s).replace(/,/g, '').match(/\d+/g);
  if (!nums) return null;
  const ns = nums.map(Number);
  return ns.length >= 2 ? Math.round((ns[0] + ns[1]) / 2) : ns[0];
}

export function parseRevenue(s) {
  if (!s) return null;
  const m = String(s).replace(/,/g, '').match(/([\d.]+)\s*([kmb])?/i);
  if (!m) return null;
  let v = parseFloat(m[1]);
  const u = (m[2] || '').toLowerCase();
  if (u === 'k') v *= 1e3; else if (u === 'm') v *= 1e6; else if (u === 'b') v *= 1e9;
  return Math.round(v);
}

// Returns array of target objects. Bare URL lists still work (no header detected).
export async function loadTargets(file) {
  const text = await readFile(file, 'utf8');
  const rows = parseCSV(text).filter((r) => r.length && r.some((c) => c && c.trim()));
  if (!rows.length) return [];

  const header = rows[0].map((c) => (c || '').toLowerCase());
  const looksRich = header.some((c) => /website|domain|company|employee|revenue/.test(c));

  if (!looksRich) {
    // bare list: "url" or "url;rank" or "url,rank"
    return rows.map((r) => {
      const first = (r[0] || '').split(/[;]/);
      const url = toOrigin(first[0]);
      const rank = parseInt(first[1] ?? r[1], 10);
      return url ? { url, rank: Number.isFinite(rank) ? rank : null } : null;
    }).filter(Boolean);
  }

  const m = mapColumns(rows[0]);
  if (m.website < 0) throw new Error('Rich CSV but no website/domain column found. Headers: ' + rows[0].join(' | '));

  const out = [];
  for (const r of rows.slice(1)) {
    const url = toOrigin(r[m.website] || '');
    if (!url) continue;
    const name = m.fullName >= 0 ? r[m.fullName] : [m.firstName >= 0 ? r[m.firstName] : '', m.lastName >= 0 ? r[m.lastName] : ''].filter(Boolean).join(' ').trim();
    out.push({
      url,
      company: m.company >= 0 ? r[m.company]?.trim() : '',
      employees: m.employees >= 0 ? parseEmployees(r[m.employees]) : null,
      revenue: m.revenue >= 0 ? parseRevenue(r[m.revenue]) : null,
      industry: m.industry >= 0 ? r[m.industry]?.trim() : '',
      country: m.country >= 0 ? r[m.country]?.trim() : '',
      state: m.state >= 0 ? r[m.state]?.trim() : '',
      email: m.email >= 0 ? r[m.email]?.trim() : '',
      contactName: name || '',
      title: m.title >= 0 ? r[m.title]?.trim() : '',
      rank: null,
    });
  }
  return out;
}
