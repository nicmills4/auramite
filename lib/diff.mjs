// Monitoring diff — the recurring-revenue core. Reduces a scan to stable "signals"
// and compares two snapshots so we can alert when a NEW leak appears (or one is fixed).
import { buildExplainers } from './explainers.mjs';

// A scan → a flat, stable signal set (finding types + specific trackers/recorders).
export function signalsOf(scan) {
  const s = new Set();
  for (const e of buildExplainers(scan)) s.add(`finding:${e.key}`);
  for (const t of scan.hardSaleShare || []) s.add(`share:${t.name}`);
  for (const t of scan.sessionRecorders || []) s.add(`replay:${t.name}`);
  for (const c of scan.chats || []) s.add(`chat:${c.name}`);
  if (scan.hasVideo && scan.hasMetaPixel) s.add('vppa:video+meta');
  return [...s].sort();
}

export function diffSignals(prev = [], curr = []) {
  const p = new Set(prev), c = new Set(curr);
  return {
    added: curr.filter((x) => !p.has(x)),     // new leaks since last scan
    resolved: prev.filter((x) => !c.has(x)),  // fixed since last scan
    kept: curr.filter((x) => p.has(x)),
  };
}
