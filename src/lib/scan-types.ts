/**
 * TypeScript shapes for the untyped .mjs scan engine. Only the fields the TS
 * side actually reads are declared — lib/scanner.mjs attaches more. If a route
 * starts using a new field, add it here rather than reaching for `any`.
 */

/** One detected tracker request from lib/scanner.mjs. */
export type TrackerHit = {
  name: string;
  category?: string;
  sample?: string;
  t?: number;
  method?: string;
};

/** The result object of scanner.scanOne(). */
export type ScanData = {
  loadError?: unknown;
  verdict?: string;
  highCount?: number;
  bannerMs?: number | null;
  sentGPC?: boolean;
  hardSaleShare?: TrackerHit[];
  sessionRecorders?: TrackerHit[];
  trackers?: TrackerHit[];
  cmps?: { name: string }[];
};

/** One finding from lib/explainers.mjs buildExplainers(). */
export type Explainer = {
  key: string;
  severity: string;
  title: string;
  paragraph: string;
  logLines?: { text: string; danger?: boolean; ok?: boolean }[];
  rule?: string;
};
