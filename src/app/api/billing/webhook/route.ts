import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { planForPriceId, planFor } from "@/lib/plans";
import type { SubStatus } from "@/generated/prisma/enums";

export const runtime = "nodejs";

const STATUS: Record<string, SubStatus> = {
  trialing: "TRIALING",
  active: "ACTIVE",
  past_due: "PAST_DUE",
  unpaid: "PAST_DUE",
  canceled: "CANCELED",
  incomplete_expired: "CANCELED",
  incomplete: "INCOMPLETE",
  paused: "INCOMPLETE",
};

/**
 * current_period_end moved onto subscription items in recent API versions, so
 * read the item first and fall back to the legacy top-level field.
 */
function periodEnd(sub: Stripe.Subscription): Date | null {
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  const raw = item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof raw === "number" ? new Date(raw * 1000) : null;
}

async function resolveOrgId(sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = sub.metadata?.orgId;
  if (fromMeta) return fromMeta;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) return null;
  const org = await db.organization.findUnique({ where: { stripeCustomerId: customerId } });
  return org?.id ?? null;
}

async function syncSubscription(sub: Stripe.Subscription) {
  const orgId = await resolveOrgId(sub);
  if (!orgId) {
    console.error("webhook: no org for subscription", sub.id);
    return;
  }

  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const plan = planForPriceId(priceId);
  if (!plan) {
    console.error("webhook: unrecognised price", priceId, "on", sub.id);
    return;
  }

  const status = STATUS[sub.status] ?? "INCOMPLETE";
  const data = {
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    plan,
    status,
    currentPeriodEnd: periodEnd(sub),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  };

  await db.subscription.upsert({
    where: { orgId },
    create: { orgId, ...data },
    update: data,
  });

  // Keep scan cadence aligned with the plan the customer is actually on, so an
  // upgrade to Enterprise starts scanning daily without manual intervention.
  const spec = planFor(plan);
  if (spec) {
    await db.page.updateMany({
      where: { site: { orgId } },
      data: { cadence: spec.cadence },
    });
  }
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !signature) {
    return NextResponse.json({ ok: false, error: "Webhook not configured." }, { status: 400 });
  }

  // Signature verification needs the exact raw body, so read text, not json.
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, secret);
  } catch (e) {
    console.error("webhook signature verification failed", e);
    return NextResponse.json({ ok: false, error: "Invalid signature." }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.subscription) {
          const id = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
          const sub = await stripe().subscriptions.retrieve(id);
          // The session carries orgId even when the subscription metadata does not.
          if (!sub.metadata?.orgId && s.metadata?.orgId) sub.metadata = { ...sub.metadata, orgId: s.metadata.orgId };
          await syncSubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      default:
        break; // everything else is ignored on purpose
    }
  } catch (e) {
    // 500 so Stripe retries — swallowing here would silently desync billing state.
    console.error("webhook handler failed", event.type, e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
