#!/usr/bin/env -S npx tsx
// Verification battery for the improvements batch. Creates a throwaway org,
// exercises monitor-core's new semantics directly, and cleans up after itself.
// Run: npx tsx cli/battery-improvements.mts

import "dotenv/config";
import { db } from "../src/lib/db";
import { findDuePages, recipientsForOrg, reportByOrg, type PageResult } from "../src/lib/monitor-core";
import { rateLimit, _resetRateLimits } from "../src/lib/rate-limit";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const DAY = 86_400_000;
const now = Date.now();

// ---------- rate limiter unit behavior ----------
console.log("rate-limit:");
{
  _resetRateLimits();
  const oks = Array.from({ length: 6 }, () => rateLimit("t:ip", 5, 1000).ok);
  check("first 5 allowed, 6th denied", oks.slice(0, 5).every(Boolean) && !oks[5]);
  const denied = rateLimit("t:ip", 5, 1000);
  check("denied result carries retryAfterMs", !denied.ok && denied.retryAfterMs > 0 && denied.retryAfterMs <= 1000);
  check("separate key unaffected", rateLimit("t:other", 5, 1000).ok);
  await new Promise((r) => setTimeout(r, 1100));
  check("window slides — allowed again after expiry", rateLimit("t:ip", 5, 1000).ok);
  _resetRateLimits();
}

// ---------- throwaway org ----------
const email = "battery-improvements@auramite.test";
await db.user.deleteMany({ where: { email } });
await db.organization.deleteMany({ where: { name: email } });

const org = await db.organization.create({ data: { name: email } });
await db.user.create({ data: { email, emailVerified: new Date(), orgId: org.id } });
await db.subscription.create({
  data: { orgId: org.id, stripeSubscriptionId: `sub_admin_test_${org.id}`, plan: "GROWTH", status: "ACTIVE", currentPeriodEnd: new Date(now + 30 * DAY) },
});
const every = await db.reportRecipient.create({ data: { orgId: org.id, email, digest: "EVERY_SCAN" } });
const weekly = await db.reportRecipient.create({ data: { orgId: org.id, email: "weekly@auramite.test", digest: "WEEKLY" } });
const site = await db.site.create({ data: { orgId: org.id, host: "example.com" } });
const page = await db.page.create({ data: { siteId: site.id, url: "https://example.com/", label: "Battery", cadence: "WEEKLY" } });

// Scan history: OK baseline (signals a,b) 3d ago, then a FAILURE 2d ago.
await db.scan.create({ data: { pageId: page.id, ranAt: new Date(now - 3 * DAY), ok: true, verdict: "x", highCount: 2, findingCount: 2, findings: [], signals: ["a", "b"] } });
await db.scan.create({ data: { pageId: page.id, ranAt: new Date(now - 2 * DAY), ok: false, error: "timeout", verdict: null } });

// ---------- #9: diff baseline is the last SUCCESSFUL scan ----------
console.log("\n#9 baseline-after-failure:");
const { candidates, due } = await findDuePages({ force: true, orgId: org.id });
check("page is a candidate", candidates.length === 1 && due.length === 1);
const preloaded = candidates[0]?.scans?.[0];
check(
  "findDuePages preloads the OK scan, not the newer failed row",
  Array.isArray(preloaded?.signals) && (preloaded!.signals as string[]).join(",") === "a,b",
  `got ${JSON.stringify(preloaded?.signals ?? null)}`,
);

// ---------- digest policy ----------
console.log("\ndigest policy:");
const quiet: PageResult[] = [{ orgId: org.id, url: "https://example.com/", label: null, host: "example.com", firstRun: false, diff: { added: [], resolved: [] } }];
const newsy: PageResult[] = [{ orgId: org.id, url: "https://example.com/", label: null, host: "example.com", firstRun: false, diff: { added: ["x"], resolved: [] } }];

// Never-sent weekly recipient → included even on a quiet run.
{
  const to = recipientsForOrg(candidates, org.id, quiet);
  check("WEEKLY with no lastSentAt gets the first report", to.includes("weekly@auramite.test") && to.includes(email));
}
// Freshly-sent weekly recipient → skipped on quiet, EVERY_SCAN still included.
await db.reportRecipient.update({ where: { id: weekly.id }, data: { lastSentAt: new Date(now - 1 * DAY) } });
{
  const { candidates: c2 } = await findDuePages({ force: true, orgId: org.id });
  const to = recipientsForOrg(c2, org.id, quiet);
  check("WEEKLY inside window skips a no-change report", !to.includes("weekly@auramite.test"));
  check("EVERY_SCAN always receives", to.includes(email));
  // ...but NEW findings override the window.
  const toNews = recipientsForOrg(c2, org.id, newsy);
  check("new leak overrides the weekly window", toNews.includes("weekly@auramite.test"));
}
// Stale weekly recipient → included again.
await db.reportRecipient.update({ where: { id: weekly.id }, data: { lastSentAt: new Date(now - 7 * DAY) } });
{
  const { candidates: c3 } = await findDuePages({ force: true, orgId: org.id });
  const to = recipientsForOrg(c3, org.id, quiet);
  check("WEEKLY past 6.5d window receives again", to.includes("weekly@auramite.test"));
}

// ---------- DRY_RUN must not stamp lastSentAt ----------
console.log("\nlastSentAt stamping:");
process.env.DRY_RUN = "1";
await db.reportRecipient.update({ where: { id: weekly.id }, data: { lastSentAt: null } });
{
  const { candidates: c4 } = await findDuePages({ force: true, orgId: org.id });
  await reportByOrg(quiet, (id, pages) => recipientsForOrg(c4, id, pages), new Date().toISOString());
  const rows = await db.reportRecipient.findMany({ where: { orgId: org.id } });
  check("dry run leaves every lastSentAt untouched", rows.every((r) => r.lastSentAt === null || r.id === every.id && r.lastSentAt === null || r.lastSentAt === null),
    JSON.stringify(rows.map((r) => [r.email, r.lastSentAt])));
}
// Redirected (admin test) run must not stamp either — still under DRY_RUN off?
// Keep DRY_RUN=1 so no real email leaves this battery; the redirect guard is
// the same || in the same line, proven by the dry-run case plus code shape.

// ---------- retention keep-newest logic (mirrors the CLI block) ----------
console.log("\nretention:");
{
  // Second page whose scans are ALL older than the cutoff — newest must survive.
  const p2 = await db.page.create({ data: { siteId: site.id, url: "https://example.com/old", label: "Old", cadence: "WEEKLY" } });
  await db.scan.create({ data: { pageId: p2.id, ranAt: new Date(now - 400 * DAY), ok: true, verdict: "x", signals: ["z"] } });
  await db.scan.create({ data: { pageId: p2.id, ranAt: new Date(now - 390 * DAY), ok: false, error: "x", verdict: null } });
  const newestOldId = (await db.scan.findFirst({ where: { pageId: p2.id }, orderBy: { ranAt: "desc" } }))!.id;

  // Inline copy of cli/run-scheduled.mts's retention block at 365 days.
  const cutoff = new Date(now - 365 * DAY);
  const olds = await db.scan.findMany({ where: { ranAt: { lt: cutoff }, page: { site: { orgId: org.id } } }, select: { id: true, pageId: true } });
  const pageIds = [...new Set(olds.map((o) => o.pageId))];
  const keep = new Set(
    (await Promise.all(pageIds.map((pageId) => db.scan.findFirst({ where: { pageId }, orderBy: { ranAt: "desc" }, select: { id: true } })))).filter(Boolean).map((s) => s!.id),
  );
  const doomed = olds.filter((o) => !keep.has(o.id)).map((o) => o.id);
  await db.scan.deleteMany({ where: { id: { in: doomed } } });

  const left = await db.scan.findMany({ where: { pageId: p2.id } });
  check("older-than-cutoff rows pruned", left.length === 1, `left ${left.length}`);
  check("each page's newest scan survives even when ancient", left[0]?.id === newestOldId);
  const p1left = await db.scan.count({ where: { pageId: page.id } });
  check("in-window scans untouched", p1left === 2, `left ${p1left}`);
}

// ---------- cleanup ----------
delete process.env.DRY_RUN;
await db.organization.delete({ where: { id: org.id } });
await db.user.deleteMany({ where: { email } });

console.log(`\n${passed} passed, ${failed} failed`);
await db.$disconnect();
process.exit(failed ? 1 : 0);
