// State layer — per-site scan snapshots (for the new-leak diff) + last-run time.
// File-based now (data/monitor/<host>.json). SWAP THIS MODULE for Postgres when you
// move to ephemeral compute — the snapshot MUST persist off the batch machine or the
// diff always looks like a first run. Same two functions, different backing store.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = join('data', 'monitor');

export async function getState(host) {
  try { return JSON.parse(await readFile(join(DIR, `${host}.json`), 'utf8')); }
  catch { return null; }
}

export async function saveState(host, state) {
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, `${host}.json`), JSON.stringify(state, null, 2));
}
