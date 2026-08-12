"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, isAdminEmail } from "@/lib/admin";
import { db } from "@/lib/db";
import { isEmail } from "@/lib/email";
import { PLANS, planFor } from "@/lib/plans";
import { findDuePages, scanAndRecord, reportByOrg, recipientsForOrg } from "@/lib/monitor-core";
import type { Plan, SubStatus } from "@/generated/prisma/enums";

export type AdminState = { error?: string; ok?: string } | null;

/**
 * Every test send lands here instead of the customer. Falls back to the lead
 * inbox, which is already configured, so this needs no new variable.
 */
const TEST_INBOX = () => process.env.ADMIN_TEST_EMAIL || process.env.LEAD_NOTIFY_EMAIL || "";

function normalizeUrl(input: string) {
  const raw = input.trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withScheme);
  return { url: url.toString(), host: url.hostname.replace(/^www\./, "") };
}

/**
 * Creates a whole customer in one go — user, org, recipient, subscription,
 * site and page — because doing it by hand across six tables is where mistakes
 * live. The subscription is written directly rather than through Stripe: this
 * exists to exercise the pipeline, not to take money.
 */
export async function createTestCustomer(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const plan = String(formData.get("plan") || "GROWTH") as Plan;
  const rawUrl = String(formData.get("url") || "").trim();

  if (!isEmail(email)) return { error: "Enter a valid email address." };
  // An admin address must never be attached to a simulated customer: it would
  // bind an admin identity to a fake org and subscription, and a later real
  // sign-in would land in it. Signing in as an admin is already safe — the
  // magic link only reaches the real inbox — but this stops the account being
  // squatted from inside the panel.
  if (isAdminEmail(email)) return { error: "That address is on the admin allowlist. Use a different one." };
  if (!PLANS.some((p) => p.plan === plan)) return { error: "Unknown plan." };

  let target: { url: string; host: string } | null = null;
  if (rawUrl) {
    try {
      target = normalizeUrl(rawUrl);
    } catch {
      return { error: "That doesn't look like a valid URL." };
    }
  }

  const existing = await db.user.findUnique({ where: { email }, include: { org: true } });
  if (existing?.org) return { error: `${email} already belongs to an organization.` };

  const spec = planFor(plan)!;
  const org = await db.organization.create({ data: { name: email } });

  if (existing) {
    await db.user.update({ where: { id: existing.id }, data: { orgId: org.id } });
  } else {
    await db.user.create({ data: { email, emailVerified: new Date(), orgId: org.id } });
  }

  await db.reportRecipient.create({ data: { orgId: org.id, email } });
  await db.subscription.create({
    data: {
      orgId: org.id,
      // Marked so nobody mistakes a simulated subscription for a Stripe one.
      stripeSubscriptionId: `sub_admin_test_${org.id}`,
      plan,
      status: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    },
  });

  if (target) {
    const site = await db.site.create({ data: { orgId: org.id, host: target.host } });
    await db.page.create({
      data: { siteId: site.id, url: target.url, label: "Home", cadence: spec.cadence },
    });
  }

  revalidatePath("/admin");
  return { ok: `Created ${email} on ${spec.name}${target ? ` watching ${target.host}` : ""}.` };
}

export async function setSubscription(formData: FormData): Promise<void> {
  await requireAdmin();
  const orgId = String(formData.get("orgId") || "");
  const plan = String(formData.get("plan") || "") as Plan;
  const status = String(formData.get("status") || "") as SubStatus;

  const org = await db.organization.findUnique({ where: { id: orgId }, include: { subscription: true } });
  if (!org) return;

  const spec = planFor(plan);
  if (!spec) return;

  await db.subscription.upsert({
    where: { orgId },
    create: {
      orgId,
      stripeSubscriptionId: `sub_admin_test_${orgId}`,
      plan,
      status,
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    },
    update: { plan, status },
  });

  // Keep cadence aligned with the plan, exactly as the Stripe webhook does.
  await db.page.updateMany({ where: { site: { orgId } }, data: { cadence: spec.cadence } });

  revalidatePath("/admin");
}

export async function addOrgPage(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const orgId = String(formData.get("orgId") || "");
  const rawUrl = String(formData.get("url") || "").trim();
  if (!rawUrl) return { error: "Enter a page URL." };

  let target;
  try {
    target = normalizeUrl(rawUrl);
  } catch {
    return { error: "That doesn't look like a valid URL." };
  }

  const org = await db.organization.findUnique({ where: { id: orgId }, include: { subscription: true } });
  if (!org) return { error: "Organization not found." };

  const cadence = (org.subscription && planFor(org.subscription.plan)?.cadence) || "WEEKLY";
  try {
    const site = await db.site.upsert({
      where: { orgId_host: { orgId, host: target.host } },
      create: { orgId, host: target.host },
      update: {},
    });
    await db.page.create({ data: { siteId: site.id, url: target.url, cadence } });
  } catch {
    return { error: "That page is already on the list." };
  }

  revalidatePath("/admin");
  return { ok: `Added ${target.url}` };
}

export async function removeOrgPage(formData: FormData): Promise<void> {
  await requireAdmin();
  const pageId = String(formData.get("pageId") || "");
  const page = await db.page.findUnique({ where: { id: pageId } });
  if (!page) return;
  await db.page.delete({ where: { id: pageId } });
  revalidatePath("/admin");
}

/**
 * Deleting an org cascades to its sites, pages and scans, so it asks for the
 * word DELETE rather than trusting a single click.
 */
export async function deleteOrg(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const orgId = String(formData.get("orgId") || "");
  const confirm = String(formData.get("confirm") || "").trim();
  if (confirm !== "DELETE") return { error: "Type DELETE to confirm." };

  const org = await db.organization.findUnique({
    where: { id: orgId },
    include: { users: { select: { email: true } } },
  });
  if (!org) return { error: "Organization not found." };

  // Deleting an admin's own org nulls their orgId, and /dashboard and /settings
  // both bounce a user without one — a self-inflicted lockout from the customer
  // surface that is easy to trigger and confusing to diagnose.
  const admin = org.users.find((u) => isAdminEmail(u.email));
  if (admin) return { error: `${admin.email} is an admin — deleting their org would lock them out of the customer pages.` };

  await db.organization.delete({ where: { id: orgId } });
  revalidatePath("/admin");
  return { ok: `Deleted ${org.name ?? orgId}.` };
}

/**
 * Runs a real scan of one org's pages and emails the real report — but every
 * message is redirected to the test inbox, with the intended recipient kept in
 * the subject. Fire-and-forget: a scan is ~25s per page and would otherwise
 * hold the request open long enough to hit a proxy timeout.
 */
export async function runTestScan(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const orgId = String(formData.get("orgId") || "");
  const inbox = TEST_INBOX();
  if (!inbox) return { error: "Set ADMIN_TEST_EMAIL or LEAD_NOTIFY_EMAIL first." };

  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) return { error: "Organization not found." };

  const { candidates, due } = await findDuePages({ force: true, orgId });
  if (!due.length) return { error: "No enabled pages, or the org has no billable subscription." };

  void (async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const results = [];
      for (const page of due) results.push(await scanAndRecord(browser, page));
      await reportByOrg(results, (id) => recipientsForOrg(candidates, id), new Date().toISOString(), inbox);
    } catch (e) {
      console.error("admin test scan failed", e);
    } finally {
      await browser.close().catch(() => {});
    }
  })();

  return { ok: `Scanning ${due.length} page${due.length === 1 ? "" : "s"} — the report will arrive at ${inbox} shortly.` };
}
