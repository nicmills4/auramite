#!/usr/bin/env -S npx tsx
// End-to-end battery for cli/run-scheduled.mts: seeds an org whose page has an
// OK baseline followed by a failure, runs the real CLI (dry-run, forced), and
// asserts the emailed diff reads "fixed" (baseline survived the failure), the
// healthcheck success ping fired, and a crashed run pings /fail and exits 1.
// Run: npx tsx cli/battery-cli-run.mts

import "dotenv/config";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { db } from "../src/lib/db";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

// ---- ping listener ----
const pings: string[] = [];
const srv = createServer((req, res) => { pings.push(`${req.method} ${req.url}`); res.end("ok"); });
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const addr = srv.address();
if (!addr || typeof addr === "string") throw new Error("listener has no port");
const PING = `http://127.0.0.1:${addr.port}/ping`;

// ---- seed ----
const DAY = 86_400_000;
const now = Date.now();
const email = "battery-cli@auramite.test";
await db.user.deleteMany({ where: { email } });
await db.organization.deleteMany({ where: { name: email } });
const org = await db.organization.create({ data: { name: email } });
await db.user.create({ data: { email, emailVerified: new Date(), orgId: org.id } });
await db.subscription.create({ data: { orgId: org.id, stripeSubscriptionId: `sub_admin_test_${org.id}`, plan: "STARTER", status: "ACTIVE", currentPeriodEnd: new Date(now + 30 * DAY) } });
await db.reportRecipient.create({ data: { orgId: org.id, email } });
const site = await db.site.create({ data: { orgId: org.id, host: "example.com" } });
const page = await db.page.create({ data: { siteId: site.id, url: "https://example.com/", label: "CLI battery", cadence: "WEEKLY" } });
await db.scan.create({ data: { pageId: page.id, ranAt: new Date(now - 3 * DAY), ok: true, verdict: "x", highCount: 2, findingCount: 2, findings: [], signals: ["meta-pixel", "tiktok-pixel"] } });
await db.scan.create({ data: { pageId: page.id, ranAt: new Date(now - 2 * DAY), ok: false, error: "net::ERR_TIMED_OUT", verdict: null } });

rmSync("data/outbox", { recursive: true, force: true });

// Async spawn — spawnSync would block this process's event loop, deadlocking
// the child's healthcheck fetch against our own listener. No shell: run the
// .mts through node with the tsx loader directly.
function runCli(args: string[], env: Record<string, string>): Promise<{ status: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "cli/run-scheduled.mts", ...args], {
      env: { ...process.env, ...env },
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    const killer = setTimeout(() => child.kill(), 180_000);
    child.on("close", (status: number | null) => { clearTimeout(killer); resolve({ status, out }); });
  });
}

// ---- run 1: real forced dry run ----
console.log("forced dry run (scans example.com — ~30s):");
const run = await runCli(["--force", "--dry-run", "--org", org.id], { HEALTHCHECK_URL: PING });
const out = run.out;
check("exits 0", run.status === 0, `status ${run.status}`);
check("scanned exactly the battery page", out.includes("due now: 1"), out.slice(0, 300));
check("run completed", out.includes("RUN COMPLETE"));

const scans = await db.scan.findMany({ where: { pageId: page.id }, orderBy: { ranAt: "desc" } });
check("new scan row persisted ok", scans.length === 3 && scans[0].ok === true, `rows ${scans.length}`);

// The email: example.com fires nothing, so vs the [meta,tiktok] baseline the
// delta must be "2 fixed" — NOT "first scan (baseline recorded)". This is the
// user-facing proof that a failure no longer resets the baseline.
let outbox: string[] = [];
try { outbox = readdirSync("data/outbox").filter((f) => f.endsWith(".txt")); } catch {}
check("outbox email written", outbox.length >= 1, `found ${outbox.length}`);
if (outbox.length) {
  const body = readFileSync(`data/outbox/${outbox[0]}`, "utf8");
  check("delta says fixed, not baseline", /2 fixed/.test(body) && !/baseline recorded/i.test(body),
    body.split("\n").slice(0, 12).join(" | "));
}
check("success ping fired once", pings.filter((p) => p === "POST /ping").length === 1, JSON.stringify(pings));

// ---- run 2: crash path ----
console.log("crash path (dead DATABASE_URL):");
const crash = await runCli(["--force", "--org", org.id], {
  HEALTHCHECK_URL: PING,
  DATABASE_URL: "postgresql://nobody:nope@127.0.0.1:1/void",
});
check("crashed run exits 1", crash.status === 1, `status ${crash.status}`);
check("RUN CRASHED logged", crash.out.includes("RUN CRASHED"));
check("/fail ping fired", pings.some((p) => p === "POST /ping/fail"), JSON.stringify(pings));

// ---- cleanup ----
await db.organization.delete({ where: { id: org.id } });
await db.user.deleteMany({ where: { email } });
rmSync("data/outbox", { recursive: true, force: true });
srv.close();

console.log(`\n${passed} passed, ${failed} failed`);
await db.$disconnect();
process.exit(failed ? 1 : 0);
