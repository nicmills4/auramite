import type { Plan } from "@/generated/prisma/enums";

// One place defining what each plan is worth, so the pricing page, the checkout
// route and the monitoring runner cannot drift apart on limits.
export type PlanSpec = {
  plan: Plan;
  name: string;
  price: string;
  per: string;
  tag: string;
  hot: boolean;
  feats: string[];
  /** Max pages the org may enable for scanning. */
  pageLimit: number;
  cadence: "DAILY" | "WEEKLY";
  /** Stripe price id, from env so test/live keys can differ per environment. */
  priceEnv: string;
};

export const PLANS: PlanSpec[] = [
  {
    plan: "STARTER",
    name: "Starter",
    price: "$99",
    per: "/mo",
    tag: "Keep your homepage clean",
    hot: false,
    pageLimit: 5,
    cadence: "WEEKLY",
    priceEnv: "STRIPE_PRICE_STARTER",
    feats: [
      "Weekly scans of up to 5 pages",
      "Every finding in full, with the proof",
      "Alerts the moment a new tracker appears",
      "Step-by-step fix guide",
      "Email support",
    ],
  },
  {
    plan: "GROWTH",
    name: "Growth",
    price: "$299",
    per: "/mo",
    tag: "Cover the pages that matter",
    hot: true,
    pageLimit: 25,
    cadence: "WEEKLY",
    priceEnv: "STRIPE_PRICE_GROWTH",
    feats: [
      "Everything in Starter",
      "Up to 25 pages you choose — landing pages, checkout, blog",
      "Per-page findings, so nothing hides in a subpage",
      "GPC and consent-mode verification",
      "Email support",
    ],
  },
  {
    plan: "ENTERPRISE",
    name: "Enterprise",
    price: "$999",
    per: "/mo",
    tag: "Daily cover, with a human",
    hot: false,
    pageLimit: 100,
    cadence: "DAILY",
    priceEnv: "STRIPE_PRICE_ENTERPRISE",
    feats: [
      "Everything in Growth",
      "Daily scans of up to 100 pages",
      "Live consultation to build your remediation plan",
      "Fix verification after each change",
      "Priority email support",
    ],
  },
];

export const planByName = (name: string) => PLANS.find((p) => p.name.toLowerCase() === name.toLowerCase());
export const planFor = (plan: Plan) => PLANS.find((p) => p.plan === plan);

/** Resolve a Stripe price id back to a plan, for the webhook. */
export function planForPriceId(priceId: string | null | undefined): Plan | null {
  if (!priceId) return null;
  const hit = PLANS.find((p) => process.env[p.priceEnv] === priceId);
  return hit?.plan ?? null;
}
