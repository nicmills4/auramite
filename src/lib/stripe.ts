import Stripe from "stripe";

let cached: Stripe | null = null;

/**
 * Lazily constructed so a missing key is a runtime error on the billing routes
 * only — the scanner and marketing site must still boot without Stripe configured.
 */
export function stripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set — billing is unavailable.");
  // Pinned, matching the duelr setup: an SDK bump must never silently change
  // API behaviour under a running subscription.
  cached = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
  return cached;
}

export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);
