#!/usr/bin/env -S npx tsx
// HTTP battery against the local dev server (http://localhost:3100).
// Covers: rate-limit 429s, login brute-force throttling at the Auth.js
// callback (the endpoint an attacker would actually hit), the verify-email
// flow + banner, and the printable report's tenancy.
// Run: npx tsx cli/battery-http.mts

import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/passwords";

const BASE = "http://localhost:3100";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

// ---------- seed: two users in two orgs ----------
const DAY = 86_400_000;
const now = Date.now();
const PASSWORD = "battery-pass-123";

async function makeCustomer(email: string, withPage: boolean) {
  await db.user.deleteMany({ where: { email } });
  await db.organization.deleteMany({ where: { name: email } });
  const org = await db.organization.create({ data: { name: email } });
  const user = await db.user.create({
    data: { email, passwordHash: await hashPassword(PASSWORD), emailVerified: null, orgId: org.id },
  });
  await db.reportRecipient.create({ data: { orgId: org.id, email } });
  await db.subscription.create({
    data: { orgId: org.id, stripeSubscriptionId: `sub_admin_test_${org.id}`, plan: "STARTER", status: "ACTIVE", currentPeriodEnd: new Date(now + 30 * DAY) },
  });
  let pageId: string | null = null;
  if (withPage) {
    const site = await db.site.create({ data: { orgId: org.id, host: "example.com" } });
    const page = await db.page.create({ data: { siteId: site.id, url: "https://example.com/", label: "HTTP battery", cadence: "WEEKLY" } });
    pageId = page.id;
    await db.scan.create({
      data: {
        pageId: page.id, ranAt: new Date(now - 1 * DAY), ok: true, verdict: "LIKELY NON-COMPLIANT", highCount: 1, findingCount: 1,
        findings: [{ key: "preconsent-share", severity: "HIGH", title: "Visitor data shared with advertisers before consent", paragraph: "p", logLines: [{ text: "0.80s  GET  connect.facebook.net/en_US/fbevents.js", danger: true }], rule: "r" }],
        signals: ["meta-pixel"],
      },
    });
  }
  return { org, user, pageId };
}

const alice = await makeCustomer("battery-alice@auramite.test", true);
const mallory = await makeCustomer("battery-mallory@auramite.test", false);

// ---------- credentials sign-in over HTTP (the CSRF dance) ----------
async function signIn(email: string, password: string, jarIn?: string): Promise<{ ok: boolean; jar: string }> {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { headers: jarIn ? { cookie: jarIn } : {} });
  const { csrfToken } = await csrfRes.json();
  const csrfCookies = csrfRes.headers.getSetCookie().map((c) => c.split(";")[0]);
  const jar = [...(jarIn ? [jarIn] : []), ...csrfCookies].join("; ");

  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar },
    body: new URLSearchParams({ csrfToken, email, password }),
  });
  const setCookies = res.headers.getSetCookie().map((c) => c.split(";")[0]);
  const sessionCookie = setCookies.find((c) => c.includes("authjs.session-token"));
  const outJar = [...csrfCookies, ...setCookies].join("; ");
  // Success = a session token was minted; failure redirects back to /login with error.
  return { ok: Boolean(sessionCookie), jar: outJar };
}

// ---------- login throttle at the callback endpoint ----------
console.log("login brute-force (Auth.js callback):");
{
  let successBeforeLimit = false;
  for (let i = 0; i < 10; i++) {
    const r = await signIn(alice.user.email, "wrong-password");
    if (r.ok) successBeforeLimit = true;
  }
  check("10 wrong passwords all rejected", !successBeforeLimit);
  // 11th attempt with the CORRECT password: the window is spent, so even the
  // real password is refused — that is the throttle doing its job.
  const blocked = await signIn(alice.user.email, PASSWORD);
  check("correct password refused while throttled", !blocked.ok);
  // Different account from the same IP is untouched (key includes the email).
  const other = await signIn(mallory.user.email, PASSWORD);
  check("other account unaffected (key is IP+email)", other.ok);
}

// ---------- verify-email flow ----------
console.log("\nverify-email:");
let aliceJar = "";
{
  // Clear alice's throttle by waiting? No — mint her session via a fresh
  // server-side token instead: insert a verification token directly and use
  // the page, then sign her in AFTER the window issue is dodged by using
  // mallory... alice is login-throttled for 15 min, so drive her flow with
  // direct tokens + a session minted for mallory where needed.
  const token = randomBytes(32).toString("base64url");
  await db.verificationToken.create({
    data: { identifier: `verify:${alice.user.email}`, token: sha256(token), expires: new Date(now + 3600e3) },
  });
  const res = await fetch(`${BASE}/verify-email?token=${token}&email=${encodeURIComponent(alice.user.email)}`);
  const body = await res.text();
  check("verify link lands 200 with confirmation", res.status === 200 && body.includes("Email confirmed"), `status ${res.status}`);
  const fresh = await db.user.findUnique({ where: { email: alice.user.email } });
  check("emailVerified set in DB", Boolean(fresh?.emailVerified));
  const again = await fetch(`${BASE}/verify-email?token=${token}&email=${encodeURIComponent(alice.user.email)}`);
  check("second use says already confirmed", (await again.text()).includes("already confirmed"));

  const badToken = await fetch(`${BASE}/verify-email?token=nope&email=${encodeURIComponent(mallory.user.email)}`);
  const badBody = await badToken.text();
  check("garbage token rejected for unverified user", badBody.includes("Link problem"));
  const mFresh = await db.user.findUnique({ where: { email: mallory.user.email } });
  check("garbage token did not verify anyone", !mFresh?.emailVerified);
}

// ---------- banner presence ----------
console.log("\nunverified banner:");
{
  const m = await signIn(mallory.user.email, PASSWORD);
  check("mallory signs in", m.ok);
  const dash = await fetch(`${BASE}/dashboard`, { headers: { cookie: m.jar } });
  const html = await dash.text();
  check("unverified user sees the confirm banner", html.includes("Confirm your email address"));

  // alice is verified now — mint her session directly (bypasses her throttled
  // login) by... waiting is silly; use a second wrong-key: her throttle key is
  // IP+email and the window is 15 min. Instead assert the negative with a
  // direct DB flip on mallory.
  await db.user.update({ where: { email: mallory.user.email }, data: { emailVerified: new Date() } });
  const dash2 = await fetch(`${BASE}/dashboard`, { headers: { cookie: m.jar } });
  const html2 = await dash2.text();
  check("banner gone once verified", !html2.includes("Confirm your email address"));
  aliceJar = m.jar; // reuse mallory's session for tenancy checks below (she owns no pages)
}

// ---------- printable report tenancy ----------
console.log("\nprintable report:");
{
  const anon = await fetch(`${BASE}/pages/${alice.pageId}/report`, { redirect: "manual" });
  check("signed-out → redirect to login", anon.status >= 300 && anon.status < 400 && String(anon.headers.get("location")).includes("/login"), `status ${anon.status}`);

  // mallory (other tenant) → 404
  const cross = await fetch(`${BASE}/pages/${alice.pageId}/report`, { headers: { cookie: aliceJar } });
  check("cross-tenant page id → 404", cross.status === 404, `status ${cross.status}`);

  // owner → 200 with letterhead + finding. Alice's login is throttled; mint a
  // session for her via a fresh IP? clientIp falls back to "local" for all dev
  // requests, so instead ride x-forwarded-for to shift the key.
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json();
  const jar = csrfRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar, "x-forwarded-for": "203.0.113.7" },
    body: new URLSearchParams({ csrfToken, email: alice.user.email, password: PASSWORD }),
  });
  const sess = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.includes("authjs.session-token"));
  check("alice signs in from a fresh IP (throttle is per IP+email)", Boolean(sess));
  if (sess) {
    const own = await fetch(`${BASE}/pages/${alice.pageId}/report`, { headers: { cookie: [jar, sess].join("; ") } });
    const html = await own.text();
    check("owner gets the printable report", own.status === 200 && html.includes("Privacy scan report") && html.includes("Visitor data shared with advertisers"), `status ${own.status}`);
    check("report shows the standing", html.includes("Data leak detected"));
  }
}

// ---------- scan API rate limits ----------
console.log("\nscan API 429s:");
{
  // Bad bodies: the limiter runs before parsing, so each costs a slot without
  // launching Chromium. 6 allowed (400), 7th → 429 with Retry-After.
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) {
    const r = await fetch(`${BASE}/api/scan`, { method: "POST", body: "{", headers: { "content-type": "application/json" } });
    statuses.push(r.status);
    if (i === 6) check("Retry-After header present", Boolean(r.headers.get("retry-after")));
  }
  check("/api/scan: 6 allowed then 429", statuses.slice(0, 6).every((s) => s === 400) && statuses[6] === 429, statuses.join(","));

  const s2: number[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${BASE}/api/scan-email`, { method: "POST", body: "{", headers: { "content-type": "application/json" } });
    s2.push(r.status);
  }
  check("/api/scan-email: 3 allowed then 429", s2.slice(0, 3).every((s) => s === 400) && s2[3] === 429, s2.join(","));

  // A different IP is its own bucket.
  const other = await fetch(`${BASE}/api/scan`, { method: "POST", body: "{", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.9" } });
  check("different IP unaffected", other.status === 400, `status ${other.status}`);
}

// ---------- cleanup ----------
for (const u of [alice, mallory]) {
  await db.organization.delete({ where: { id: u.org.id } }).catch(() => {});
  await db.user.deleteMany({ where: { email: u.user.email } });
  await db.verificationToken.deleteMany({ where: { identifier: { in: [`verify:${u.user.email}`, `reset:${u.user.email}`] } } });
}

console.log(`\n${passed} passed, ${failed} failed`);
await db.$disconnect();
process.exit(failed ? 1 : 0);
