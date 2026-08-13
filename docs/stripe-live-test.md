# Stripe live-mode dry run

One real $99 charge on your own card, refunded at the end, proving the whole
money path works before a stranger's card ever touches it. Total cost: ~$3 in
non-refundable Stripe processing fees. Time: ~15 minutes.

## Before you start

Run the preflight where the production variables are available (Railway shell,
or locally with the live keys exported):

```bash
npx tsx cli/stripe-preflight.mts
```

It verifies the key, all three price ids (amount, currency, monthly interval,
active, product name), and the webhook endpoint + events. Fix anything it flags
first — every failure it can catch is one you'd otherwise discover mid-checkout.

Also confirm in the Stripe Dashboard (top-left toggle) that you are looking at
**Live mode** when checking any of this. Test-mode data and live-mode data are
entirely separate worlds: prices, webhooks, and keys do not carry over.

## The run

Use an email that is NOT on `ADMIN_EMAILS` and not your normal account — this
is a throwaway customer you will delete after.

1. **Sign up** at auramite.io with the throwaway email. Confirm the
   verification email arrives and the link works.
2. **Settings → pick Starter ($99/mo).** Complete checkout with your real card.
3. **Watch it land** (all three should happen within ~10 seconds):
   - Stripe Dashboard → Payments shows the $99 charge.
   - Settings shows *Starter · Active* with the renewal date.
   - Stripe Dashboard → Developers → Webhooks → the endpoint shows a
     successful `checkout.session.completed` delivery (2xx). A failed delivery
     here with money taken is the worst bug this test can catch.
4. **Add a page** in Settings — confirm the plan's page limit applies.
5. **Billing portal round-trip**: Settings → Manage billing → opens the Stripe
   portal → back link returns to Settings.
6. **From the admin panel**, run a test scan on the throwaway org — the report
   arrives at the test inbox and looks right.

## Unwind it

1. Stripe Dashboard → Customers → the throwaway → **Cancel subscription**
   (immediately, not at period end).
2. Confirm the app noticed: Settings now shows no active plan (the
   `customer.subscription.deleted` webhook did this — if it still shows Active
   after a minute, the webhook is broken and that's a real finding).
3. Payments → the $99 charge → **Refund** (full). Stripe keeps the processing
   fee; the rest returns in 5–10 days.
4. Admin panel → delete the throwaway org (type DELETE).

## What this proved

- Live keys, live prices, live webhook — all consistent with the code.
- A real card can pay, and the subscription state machine reacts end to end:
  checkout → active → portal → cancel → deactivated.
- Verification email + report email deliver in production.

Nothing else needs a live-mode rehearsal; payment failure and dunning paths ride
the same webhook plumbing this run exercised (`invoice.payment_failed` was
already covered by test-mode work).
