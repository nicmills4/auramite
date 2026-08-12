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
