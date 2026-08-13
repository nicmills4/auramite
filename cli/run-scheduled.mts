#!/usr/bin/env -S npx tsx
// Scheduled monitoring run — the subscription product.
//
// Reads active subscribers' pages from Postgres, scans whichever are due per the
// page's cadence, diffs each against that page's last successful scan to find
// NEW leaks, writes the results back, emails each customer one report covering
// all their pages, and emails the operator a run summary.
//
// Usage: npx tsx cli/run-scheduled.mts [--force] [--dry-run] [--org <id>]
//   --force    scan every enabled page regardless of cadence
//   --dry-run  write emails to data/outbox/ instead of sending
//   --org      restrict the run to one organization (for testing)
//
// Env: HEALTHCHECK_URL — pinged on success, <url>/fail on a crash, so a run
// that dies is noticed rather than silently skipped forever.
//      SCAN_RETENTION_DAYS — prune scan rows older than this (default 365);
// each page's most recent scan always survives.
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

const ping = async (suffix = "") => {
  const url = process.env.HEALTHCHECK_URL;
  if (!url) return;
  await fetch(`${url}${suffix}`, { method: "POST" }).catch(() => {});
};

try {
  const { candidates, due } = await findDuePages({ force, orgId: onlyOrg });

  console.log(`Subscriber pages: ${candidates.length} · due now: ${due.length}${force ? " (forced)" : ""}`);
  if (!due.length) {
    console.log("Nothing due. Exiting.");
    await ping();
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
  const byOrg = await reportByOrg(results, (orgId, pages) => recipientsForOrg(candidates, orgId, pages), ranAt);

  const operator = process.env.OPERATOR_EMAIL;
  if (operator) {
    // Guarded: by this point customers have their reports, and a summary bug
    // must not crash the container into a state where the cron marks the run
    // as still in progress and skips the next one.
    try {
      await sendSummary({ to: operator, ranAt, results });
    } catch (e) {
      console.error("operator summary failed (customer reports already sent):", e);
    }
  }

  // ---- retention: prune old scan rows, always keeping each page's newest ----
  try {
    const days = Number(process.env.SCAN_RETENTION_DAYS || 365);
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const olds = await db.scan.findMany({
      where: { ranAt: { lt: cutoff } },
      select: { id: true, pageId: true },
    });
    if (olds.length) {
      const pageIds = [...new Set(olds.map((o) => o.pageId))];
      const keep = new Set(
        (
          await Promise.all(
            pageIds.map((pageId) =>
              db.scan.findFirst({ where: { pageId }, orderBy: { ranAt: "desc" }, select: { id: true } }),
            ),
          )
        )
          .filter(Boolean)
          .map((s) => s!.id),
      );
      const doomed = olds.filter((o) => !keep.has(o.id)).map((o) => o.id);
      for (let j = 0; j < doomed.length; j += 500) {
        await db.scan.deleteMany({ where: { id: { in: doomed.slice(j, j + 500) } } });
      }
      if (doomed.length) console.log(`retention: pruned ${doomed.length} scan(s) older than ${days}d`);
    }
  } catch (e) {
    console.error("retention pruning failed (non-fatal):", e);
  }

  const withNew = results.filter((r) => !r.error && !r.firstRun && r.diff?.added.length);
  const failed = results.filter((r) => r.error);
  console.log("\n━━ RUN COMPLETE ━━");
  console.log(
    `${results.length} page(s) across ${byOrg.size} customer(s) · new leaks on ${withNew.length} · failures ${failed.length}`,
  );
  withNew.forEach((r) => console.log(`  NEW  ${r.label || r.url}: +${r.diff!.added.length}`));
  if (process.env.DRY_RUN === "1") console.log("DRY RUN — emails written to data/outbox/, nothing sent.");

  await ping();
  await db.$disconnect();

  // Exit explicitly. A cron container that never terminates is treated as still
  // running, and the next scheduled run is skipped — so a single lingering
  // Playwright handle would silently stop all monitoring. A page that failed to
  // load is a normal outcome, not a failed run, so this stays 0 regardless.
  process.exit(0);
} catch (e) {
  console.error("RUN CRASHED:", e);
  await ping("/fail");
  await db.$disconnect().catch(() => {});
  process.exit(1);
}
