import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { planByName } from "@/lib/plans";

export const runtime = "nodejs";

const BASE = process.env.NEXT_PUBLIC_BASE_URL || "https://auramite.io";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  }

  let body: { plan?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const spec = planByName(String(body?.plan || ""));
  if (!spec) return NextResponse.json({ ok: false, error: "Unknown plan." }, { status: 400 });

  const priceId = process.env[spec.priceEnv];
  if (!priceId) {
    return NextResponse.json({ ok: false, error: `${spec.priceEnv} is not configured.` }, { status: 500 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { org: { include: { subscription: true } } },
  });
  if (!user?.org) return NextResponse.json({ ok: false, error: "No organization on this account." }, { status: 400 });

  try {
    // Reuse the org's Stripe customer so a second purchase doesn't create a
    // duplicate customer record with a split billing history.
    let customerId = user.org.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe().customers.create({
        email: user.email,
        metadata: { orgId: user.org.id },
      });
      customerId = customer.id;
      await db.organization.update({ where: { id: user.org.id }, data: { stripeCustomerId: customerId } });
    }

    const checkout = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      // payment_method_types is deliberately omitted so Stripe serves whichever
      // methods are eligible per customer. Hardcoding it to ["card"] would lock
      // out everything else and cost conversion.
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${BASE}/account?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE}/account?checkout=cancelled`,
      allow_promotion_codes: true,
      // Labels the flow in the Stripe Dashboard so checkout funnels can be
      // compared. Fixed, not per-request — a rotating value would not group.
      integration_identifier: "auramite_subscription_kvtwzmrb",
      subscription_data: { metadata: { orgId: user.org.id } },
      // Mirrored on the session too: subscription.metadata is not present on the
      // completed-session event, and the webhook needs the org either way.
      metadata: { orgId: user.org.id },
    });

    return NextResponse.json({ ok: true, url: checkout.url });
  } catch (e) {
    console.error("checkout failed", e);
    return NextResponse.json({ ok: false, error: "Could not start checkout." }, { status: 500 });
  }
}
