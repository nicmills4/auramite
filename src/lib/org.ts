import { db } from "./db";

/**
 * Every user needs an Organization — it owns the sites, recipients and the
 * subscription. Shared by password signup and any future adapter-created
 * flows, so the two can never drift on what a "complete" account means.
 */
export async function ensureOrgForUser(userId: string, email: string | null | undefined): Promise<string> {
  const existing = await db.user.findUnique({ where: { id: userId }, select: { orgId: true } });
  if (existing?.orgId) return existing.orgId;

  const org = await db.organization.create({ data: { name: email ?? undefined } });
  await db.user.update({ where: { id: userId }, data: { orgId: org.id } });

  // Seed the first report recipient so a new customer receives reports before
  // ever touching settings. Guarded — a hiccup here must not break signup.
  if (email) {
    await db.reportRecipient
      .create({ data: { orgId: org.id, email: email.toLowerCase() } })
      .catch(() => {});
  }
  return org.id;
}
