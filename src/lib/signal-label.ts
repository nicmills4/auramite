/**
 * Turns a stored signal key into something a customer can read.
 *
 * Deliberately duplicates the private `label()` in lib/notify.mjs rather than
 * exporting it: that module is untyped ESM shared with the CLI, and importing
 * it here would drag the mail layer into the web bundle. If the signal
 * vocabulary in lib/diff.mjs changes, update both.
 */
export function signalLabel(signal: string): string {
  if (signal.startsWith("share:")) return `shares data with ${signal.slice(6)}`;
  if (signal.startsWith("replay:")) return `session-replay: ${signal.slice(7)}`;
  if (signal.startsWith("chat:")) return `chat widget: ${signal.slice(5)}`;
  if (signal.startsWith("vppa:")) return "video + Meta Pixel (VPPA)";
  if (signal.startsWith("finding:")) return signal.slice(8).replace(/-/g, " ");
  return signal;
}
