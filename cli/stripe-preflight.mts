#!/usr/bin/env -S npx tsx
// Stripe live-mode preflight — run before the first real charge.
//
// Verifies, against whichever key is in STRIPE_SECRET_KEY:
//   1. the key works and which mode it is in (live vs test)
//   2. every STRIPE_PRICE_* env var points at a real, active, recurring
//      monthly USD price whose amount matches src/lib/plans.ts
//   3. a webhook endpoint exists for /api/billing/webhook with every event
//      the handler depends on (needs a key with webhook read; skipped politely
//      on a restricted key without it)
//
// Usage:  npx tsx cli/stripe-preflight.mts
// Exit 0 = every check passed or was skipped; 1 = at least one failure.

import "dotenv/config";
import Stripe from "stripe";

// Keep in lockstep with the checkout/webhook routes.
const API_VERSION = "2026-07-29.dahlia" as Stripe.LatestApiVersion;
const WEBHOOK_PATH = "/api/billing/webhook";
const NEEDED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
];

// Expected amounts in cents, matching the marketing copy in src/lib/plans.ts.
// Duplicated deliberately: parsing "$99" back out of display strings would let
// a formatting tweak silently change what this preflight enforces.
const EXPECTED: { env: string; name: string; cents: number }[] = [
  { env: "STRIPE_PRICE_STARTER", name: "Starter", cents: 9900 },
  { env: "STRIPE_PRICE_GROWTH", name: "Growth", cents: 29900 },
  { env: "STRIPE_PRICE_ENTERPRISE", name: "Enterprise", cents: 99900 },
];

let failures = 0;
const pass = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => { failures++; console.log(`  ✗ ${msg}`); };
const skip = (msg: string) => console.log(`  – ${msg}`);

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set. Run this where the web service's variables are available.");
  process.exit(1);
}

const live = key.startsWith("sk_live") || key.startsWith("rk_live");
console.log(`Stripe preflight — ${live ? "LIVE" : "TEST"} mode key (${key.slice(0, 8)}…)\n`);

const stripe = new Stripe(key, { apiVersion: API_VERSION });

// ---- 1. key works ----
console.log("Key:");
try {
  await stripe.prices.list({ limit: 1 });
  pass("key is valid and can read prices");
} catch (e) {
  fail(`key rejected: ${(e as Error).message}`);
  console.log(`\n${failures} failure(s).`);
  process.exit(1);
}

// ---- 2. price ids ----
console.log("\nPrices:");
for (const exp of EXPECTED) {
  const id = process.env[exp.env];
  if (!id) { fail(`${exp.env} is not set`); continue; }
  try {
    const price = await stripe.prices.retrieve(id, { expand: ["product"] });
    const problems: string[] = [];
    if (!price.active) problems.push("price is archived");
    if (price.currency !== "usd") problems.push(`currency is ${price.currency}, expected usd`);
    if (price.recurring?.interval !== "month") problems.push(`interval is ${price.recurring?.interval ?? "one-time"}, expected month`);
    if (price.unit_amount !== exp.cents) problems.push(`amount is ${price.unit_amount}, expected ${exp.cents} ($${exp.cents / 100}/mo)`);
    const product = price.product as Stripe.Product;
    if (typeof product === "object" && product.name && !product.name.toLowerCase().includes(exp.name.toLowerCase())) {
      // Checkout shows the Product name on the line item, so a mismatch here
      // is customer-visible even though nothing technically breaks.
      problems.push(`product is named "${product.name}" — customers will see that at checkout, expected something containing "${exp.name}"`);
    }
    if (problems.length) fail(`${exp.env} (${id}): ${problems.join("; ")}`);
    else pass(`${exp.env} → ${typeof product === "object" ? product.name : id} · $${(price.unit_amount ?? 0) / 100}/mo · active`);
  } catch (e) {
    fail(`${exp.env} (${id}): ${(e as Error).message}`);
  }
}

// ---- 3. webhook endpoint ----
console.log("\nWebhook:");
try {
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const ours = endpoints.data.filter((w) => w.url.includes(WEBHOOK_PATH) && w.status === "enabled");
  if (!ours.length) {
    fail(`no enabled webhook endpoint whose URL contains ${WEBHOOK_PATH}`);
  } else {
    for (const w of ours) {
      const events = new Set(w.enabled_events);
      const all = events.has("*");
      const missing = all ? [] : NEEDED_EVENTS.filter((e) => !events.has(e));
      if (missing.length) fail(`${w.url}: missing events ${missing.join(", ")}`);
      else pass(`${w.url} · ${all ? "all events" : NEEDED_EVENTS.length + " needed events subscribed"}`);
    }
  }
} catch (e) {
  const msg = (e as Error).message;
  // A restricted key without webhook read lands here — that's a fine key
  // choice, so this is a skip with instructions rather than a failure.
  if (/permission|restricted/i.test(msg)) {
    skip(`key cannot read webhook endpoints (${msg.split(".")[0]}). Verify by eye: Stripe Dashboard → Developers → Webhooks → an enabled endpoint ending ${WEBHOOK_PATH} subscribed to: ${NEEDED_EVENTS.join(", ")}`);
  } else {
    fail(`webhook check errored: ${msg}`);
  }
}

console.log(failures ? `\n${failures} failure(s) — fix before charging real cards.` : "\nAll checks passed.");
if (live && !failures) {
  console.log("Live mode looks ready. The $99 dry run is yours: docs/stripe-live-test.md");
}
process.exit(failures ? 1 : 0);
