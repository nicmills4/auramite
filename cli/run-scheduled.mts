#!/usr/bin/env -S npx tsx
// Scheduled monitoring run — the subscription product.
//
// Reads active subscribers' pages from Postgres, scans whichever are due per the
// page's cadence, diffs each against that page's previous scan to find NEW leaks,
// writes the results back, emails each customer one report covering all their
// pages, and emails the operator a run summary.
//
// Usage: npx tsx cli/run-scheduled.mts [--force] [--dry-run] [--org <id>]
//   --force    scan every enabled page regardless of cadence
//   --dry-run  write emails to data/outbox/ instead of sending
//   --org      restrict the run to one organization (for testing)
//
// The scan/diff/persist/report logic lives in src/lib/monitor-core.ts so this
// CLI and the admin panel's test-run button cannot drift apart.

import "dotenv/config";
import { chromium } from "playwright";
import { db } from "../src/lib/db";
import {
  findDuePages,
  scanAndRecord,
  reportByOrg,
  recipientsForOrg,
  type PageResult,
} from "../src/lib/monitor-core";
import { sendSummary } from "../lib/notify.mjs";

const args = process.argv.slice(2);
const force = args.includes("--force");
// Read the value only when --org is actually present: indexOf returns -1 when it
// is absent, and args[0] would otherwise be picked up as the org id.
const orgIdx = args.indexOf("--org");
const onlyOrg = orgIdx >= 0 ? args[orgIdx + 1] : undefined;
if (args.includes("--dry-run")) process.env.DRY_RUN = "1";

const CONCURRENCY = 4;
const startedAt = Date.now();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const { candidates, due } = await findDuePages({ force, orgId: onlyOrg });

console.log(`Subscriber pages: ${candidates.length} · due now: ${due.length}${force ? " (forced)" : ""}`);
if (!due.length) {
  console.log("Nothing due. Exiting.");
  await db.$disconnect();
  process.exit(0);
}

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const results: PageResult[] = new Array(due.length);
let cursor = 0;
let done = 0;

async function worker() {
  while (cursor < due.length) {
    const i = cursor++;
    results[i] = await scanAndRecord(browser, due[i]);

    done++;
    const r = results[i];
    const tag = r.error
      ? `FAILED — ${r.error}`
      : r.firstRun
        ? "baseline"
        : r.diff?.added.length
          ? `${r.diff.added.length} NEW`
          : "no change";
    console.log(`  [${done}/${due.length}] ${r.label || r.url} — ${tag}`);
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker));
await browser.close();

const ranAt = new Date(startedAt).toISOString();
const byOrg = await reportByOrg(results, (orgId) => recipientsForOrg(candidates, orgId), ranAt);

const operator = process.env.OPERATOR_EMAIL;
if (operator) {
  // sendSummary consumes raw PageResults and does its own presentation.
  // Guarded: by this point customers have their reports, and a summary bug
  // must not crash the container into a state where the cron marks the run
  // as still in progress and skips the next one.
  try {
    await sendSummary({ to: operator, ranAt, results });
  } catch (e) {
    console.error("operator summary failed (customer reports already sent):", e);
  }
}

const withNew = results.filter((r) => !r.error && !r.firstRun && r.diff?.added.length);
const failed = results.filter((r) => r.error);
console.log("\n━━ RUN COMPLETE ━━");
console.log(
  `${results.length} page(s) across ${byOrg.size} customer(s) · new leaks on ${withNew.length} · failures ${failed.length}`,
);
withNew.forEach((r) => console.log(`  NEW  ${r.label || r.url}: +${r.diff!.added.length}`));
if (process.env.DRY_RUN === "1") console.log("DRY RUN — emails written to data/outbox/, nothing sent.");

await db.$disconnect();

// Exit explicitly. A cron container that never terminates is treated as still
// running, and the next scheduled run is skipped — so a single lingering
// Playwright handle would silently stop all monitoring. A page that failed to
// load is a normal outcome, not a failed run, so this stays 0 regardless.
process.exit(0);
