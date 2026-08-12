import { notFound } from "next/navigation";
import { auth } from "@/auth";

/**
 * Admin identity comes from an env allowlist rather than a column on User.
 * Nothing in the application writes to it, so no application bug can escalate
 * someone to admin, and revoking access is a variable change rather than a
 * migration. Cost: adding an admin needs a redeploy.
 */
function allowlist(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Whether an address would grant admin if someone signed in with it. Used to
 * keep the admin panel from creating or destroying accounts tied to an admin
 * identity — sign-in itself is already safe, since the magic link only ever
 * goes to the real inbox.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return allowlist().includes(email.trim().toLowerCase());
}

export async function isAdmin(): Promise<boolean> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  return Boolean(email && allowlist().includes(email));
}

/**
 * Call at the top of the admin page AND at the top of every admin server
 * action. Hiding a button is not access control — server actions are POST
 * endpoints that can be invoked directly.
 *
 * Fails with notFound() rather than a 403 so a non-admin never learns the
 * route exists.
 */
export async function requireAdmin(): Promise<{ email: string }> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email || !allowlist().includes(email)) notFound();
  return { email };
}
