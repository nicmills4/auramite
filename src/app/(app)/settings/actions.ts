"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { planFor } from "@/lib/plans";
import { isEmail } from "@/lib/email";

/** Beyond a handful, a recipient list is a mailing list — that is a different feature. */
const RECIPIENT_CAP = 5;

/** Feedback surfaced inline by the add-page form via useActionState. */
export type AddState = { error?: string; added?: string } | null;

/** Resolve the signed-in user's org, or throw — every action below needs one. */
async function requireOrg() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { org: { include: { subscription: true } } },
  });
  if (!user?.org) throw new Error("No organization on this account.");
  return user.org;
}

/** How many pages this org may enable, and at what cadence. */
function limitsFor(org: { subscription: { plan: "STARTER" | "GROWTH" | "ENTERPRISE"; status: string } | null }) {
  const active = org.subscription && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(org.subscription.status);
  const spec = active && org.subscription ? planFor(org.subscription.plan) : null;
  // Without an active plan a customer may still stage one page, so the account
  // page is not an empty shell before they check out.
  return { pageLimit: spec?.pageLimit ?? 1, cadence: spec?.cadence ?? "WEEKLY" as const };
}

function normalize(input: string) {
  const raw = input.trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withScheme); // throws on garbage — caller converts to a message
  return { url: url.toString(), host: url.hostname.replace(/^www\./, "") };
}

export async function addPage(_prev: AddState, formData: FormData): Promise<AddState> {
  let org;
  try {
    org = await requireOrg();
  } catch (e) {
    return { error: (e as Error).message };
  }

  const input = String(formData.get("url") || "");
  if (!input.trim()) return { error: "Enter a page URL." };

  let parsed;
  try {
    parsed = normalize(input);
  } catch {
    return { error: "That doesn't look like a valid URL." };
  }

  const { pageLimit, cadence } = limitsFor(org);
  const current = await db.page.count({ where: { site: { orgId: org.id } } });
  if (current >= pageLimit) {
    return {
      error: org.subscription
        ? `Your plan covers ${pageLimit} page${pageLimit === 1 ? "" : "s"}. Upgrade to track more.`
        : `Pick a plan to track more than ${pageLimit} page.`,
    };
  }

  try {
    const site = await db.site.upsert({
      where: { orgId_host: { orgId: org.id, host: parsed.host } },
      create: { orgId: org.id, host: parsed.host },
      update: {},
    });
    await db.page.create({
      data: { siteId: site.id, url: parsed.url, label: String(formData.get("label") || "") || null, cadence },
    });
  } catch {
    return { error: "That page is already on your list." };
  }

  revalidatePath("/settings");
  return { added: parsed.url };
}

export async function removePage(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const pageId = String(formData.get("pageId") || "");

  // Scope the lookup through the org so a forged id cannot touch another tenant.
  const page = await db.page.findFirst({
    where: { id: pageId, site: { orgId: org.id } },
    include: { site: { include: { _count: { select: { pages: true } } } } },
  });
  if (!page) return;

  await db.page.delete({ where: { id: page.id } });
  // Drop the site once its last page goes, so the list doesn't accumulate
  // empty hosts.
  if (page.site._count.pages <= 1) {
    await db.site.delete({ where: { id: page.siteId } }).catch(() => {});
  }

  revalidatePath("/settings");
}

export async function togglePage(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const pageId = String(formData.get("pageId") || "");

  const page = await db.page.findFirst({ where: { id: pageId, site: { orgId: org.id } } });
  if (!page) return;

  await db.page.update({ where: { id: page.id }, data: { enabled: !page.enabled } });
  revalidatePath("/settings");
}


export async function addRecipient(_prev: AddState, formData: FormData): Promise<AddState> {
  let org;
  try {
    org = await requireOrg();
  } catch (e) {
    return { error: (e as Error).message };
  }

  // Lowercased on the way in: the unique index is on the raw column, so
  // Ops@x.com and ops@x.com would otherwise both be stored.
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) return { error: "Enter an email address." };
  if (!isEmail(email)) return { error: "That doesn't look like a valid email address." };

  const count = await db.reportRecipient.count({ where: { orgId: org.id } });
  if (count >= RECIPIENT_CAP) {
    return { error: `Up to ${RECIPIENT_CAP} recipients. Remove one to add another.` };
  }

  try {
    await db.reportRecipient.create({ data: { orgId: org.id, email } });
  } catch {
    return { error: "That address is already on the list." };
  }

  revalidatePath("/settings");
  return { added: email };
}

export async function removeRecipient(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const id = String(formData.get("recipientId") || "");

  // Scoped through the org, so a forged id cannot touch another tenant's row.
  const row = await db.reportRecipient.findFirst({ where: { id, orgId: org.id } });
  if (!row) return;

  // Never leave zero: with no rows the monitor silently falls back to members'
  // login addresses, so an empty list would show a customer something untrue.
  const count = await db.reportRecipient.count({ where: { orgId: org.id } });
  if (count <= 1) return;

  await db.reportRecipient.delete({ where: { id: row.id } });
  revalidatePath("/settings");
}
