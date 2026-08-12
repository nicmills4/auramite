import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";

const BASE = process.env.NEXT_PUBLIC_BASE_URL || "https://auramite.io";

/**
 * Hands off to Stripe's hosted billing portal for plan changes, cancellation and
 * payment-method updates — so none of that UI (or card data) lives here.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { org: true },
  });
  if (!user?.org?.stripeCustomerId) {
    return NextResponse.json({ ok: false, error: "No billing account yet." }, { status: 400 });
  }

  try {
    const portal = await stripe().billingPortal.sessions.create({
      customer: user.org.stripeCustomerId,
      return_url: `${BASE}/account`,
    });
    return NextResponse.json({ ok: true, url: portal.url });
  } catch (e) {
    console.error("portal failed", e);
    return NextResponse.json({ ok: false, error: "Could not open the billing portal." }, { status: 500 });
  }
}
