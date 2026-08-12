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
// Snapshots live in the Scan table rather than local JSON, so the diff survives
// ephemeral compute — on a fresh container a file-based store makes every run
// look like a first run, and customers would never be told about a new leak.

import "dotenv/config";
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { scanOne, hostOf } from "../lib/scanner.mjs";
import { buildExplainers } from "../lib/explainers.mjs";
import { renderProofPage } from "../lib/proofpage.mjs";
import { signalsOf, diffSignals } from "../lib/diff.mjs";
import { sendOrgReport, sendSummary } from "../lib/notify.mjs";

const args = process.argv.slice(2);
const force = args.includes("--force");
const onlyOrg = args[args.indexOf("--org") + 1];
if (args.includes("--dry-run")) process.env.DRY_RUN = "1";

const CONCURRENCY = 4;
const GRACE_MS = 3600e3; // run an hour early rather than slipping a whole cycle
const CADENCE_MS = { DAILY: 24 * 3600e3, WEEKLY: 7 * 24 * 3600e3 } as const;
// PAST_DUE keeps scanning: they are in Stripe's retry window, and cutting a
// customer off mid-dunning is a bad way to find out a card expired.
const BILLABLE = ["ACTIVE", "TRIALING", "PAST_DUE"] as const;

/**
 * Playwright errors carry a multi-line call log with ANSI colour codes, which
 * renders as garbage in a plain-text email. Keep the first meaningful line.
 */
function cleanError(e: unknown): string {
  const raw = String((e as Error)?.message ?? e);
  const line = raw
    // eslint-disable-next-line no-control-regex
    .replace(/\[[0-9;]*m/g, "")
    .replace(/\[\d+m/g, "")
    .split("\n")[0]
    .trim();
  return line.length > 160 ? line.slice(0, 157) + "…" : line;
}

const startedAt = Date.now();
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const candidates = await db.page.findMany({
  where: {
    enabled: true,
    site: {
      ...(onlyOrg ? { orgId: onlyOrg } : {}),
      org: { subscription: { status: { in: [...BILLABLE] } } },
    },
  },
  include: {
    site: { include: { org: { include: { users: { select: { email: true } } } } } },
    // Only the previous scan is needed — it holds the signal set to diff against.
    scans: { orderBy: { ranAt: "desc" }, take: 1 },
  },
});

const due = candidates.filter((p) => {
  if (force || !p.lastScanAt) return true;
  const interval = CADENCE_MS[p.cadence] ?? CADENCE_MS.WEEKLY;
  return startedAt - p.lastScanAt.getTime() >= interval - GRACE_MS;
});

console.log(`Subscriber pages: ${candidates.length} · due now: ${due.length}${force ? " (forced)" : ""}`);
if (!due.length) {
  console.log("Nothing due. Exiting.");
  await db.$disconnect();
  process.exit(0);
}

type PageResult = {
  orgId: string;
  url: string;
  label: string | null;
  host: string;
  verdict?: string;
  firstRun?: boolean;
  diff?: { added: string[]; resolved: string[] };
  error?: string;
};

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const results: PageResult[] = new Array(due.length);
let cursor = 0;
let done = 0;

async function worker() {
  while (cursor < due.length) {
    const i = cursor++;
    const page = due[i];
    const host = hostOf(page.url);
    const orgId = page.site.orgId;

    try {
      const scan = (await scanOne(browser, page.url, { sendGPC: true, writeReports: false })) as Record<string, any>;

      if (scan.loadError) throw new Error(`couldn't load the page — ${cleanError(scan.loadError)}`);

      const explainers = buildExplainers(scan);
      const signals: string[] = signalsOf(scan);
      const prev = page.scans[0];
      const firstRun = !prev?.signals;
      const diff = firstRun
        ? { added: [], resolved: [] }
        : diffSignals((prev!.signals as string[]) ?? [], signals);

      const hard = scan.hardSaleShare || [];
      await db.scan.create({
        data: {
          pageId: page.id,
          verdict: scan.verdict,
          highCount: scan.highCount || 0,
          findingCount: explainers.length,
          bannerMs: scan.bannerMs ?? null,
          firstShareMs: hard.length ? Math.min(...hard.map((t: { t?: number }) => t.t || 0)) : null,
          findings: explainers,
          signals,
        },
      });
      await db.page.update({ where: { id: page.id }, data: { lastScanAt: new Date() } });

      const dir = join("customers", host);
      await mkdir(dir, { recursive: true });
      const { html } = renderProofPage(scan, host);
      await writeFile(join(dir, "proof.html"), html);

      results[i] = { orgId, url: page.url, label: page.label, host, verdict: scan.verdict, firstRun, diff };
    } catch (e) {
      // Record the failure so a page that is persistently unreachable is visible
      // rather than silently skipped every run.
      const error = cleanError(e);
      await db.scan
        .create({ data: { pageId: page.id, ok: false, error, verdict: null } })
        .catch(() => {});
      await db.page.update({ where: { id: page.id }, data: { lastScanAt: new Date() } }).catch(() => {});
      results[i] = { orgId, url: page.url, label: page.label, host, error };
    }

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

// One report per organization, covering every page scanned for them this run.
const byOrg = new Map<string, PageResult[]>();
for (const r of results) {
  if (!byOrg.has(r.orgId)) byOrg.set(r.orgId, []);
  byOrg.get(r.orgId)!.push(r);
}

const ranAt = new Date(startedAt).toISOString();
for (const [orgId, pages] of byOrg) {
  const recipients = due.find((p) => p.site.orgId === orgId)?.site.org.users.map((u) => u.email) ?? [];
  await sendOrgReport({ to: recipients, pages, ranAt });
}

const operator = process.env.OPERATOR_EMAIL;
if (operator) {
  await sendSummary({
    to: operator,
    ranAt,
    results: results.map((r) => ({
      host: r.label || r.url,
      error: r.error,
      verdict: r.verdict,
      firstRun: r.firstRun,
      added: r.diff?.added,
      band: r.error ? "—" : r.diff?.added.length ? "NEW" : "ok",
      score: "",
    })),
  });
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
