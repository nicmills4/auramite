"use server";

import { createHash, randomBytes } from "node:crypto";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { db } from "./db";
import { isEmail, resendSend } from "./email";
import { ensureOrgForUser } from "./org";
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "./passwords";
import { rateLimit, clientIp } from "./rate-limit";

export type AuthFormState = { error?: string; ok?: string } | null;

const BASE = () => process.env.NEXT_PUBLIC_BASE_URL || "https://auramite.io";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const SLOW_DOWN = { error: "Too many attempts. Wait a few minutes and try again." };

/**
 * Send the address-confirmation email. Failure is swallowed by callers — a
 * broken mail provider must not block signup; the banner offers a resend.
 */
async function sendVerificationEmail(email: string) {
  const token = randomBytes(32).toString("base64url");
  const identifier = `verify:${email}`;
  await db.verificationToken.deleteMany({ where: { identifier } });
  await db.verificationToken.create({
    data: { identifier, token: sha256(token), expires: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  });
  const url = `${BASE()}/verify-email?token=${token}&email=${encodeURIComponent(email)}`;
  await resendSend({
    to: email,
    subject: "Confirm your Auramite email",
    text: [
      "Welcome to Auramite. Confirm this address so your scan reports reach you:",
      "",
      url,
      "",
      "The link works for 24 hours. If you didn't create an account, ignore this email.",
      "",
      "— Auramite",
    ].join("\n"),
  });
}

function validPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 200) return "That password is too long.";
  return null;
}

/** Sign in with email + password. Redirects to /dashboard on success. */
export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!isEmail(email) || !password) return { error: "Enter your email and password." };

  // The enforcing throttle lives in authorize() (src/auth.ts), which also
  // covers direct hits on /api/auth/callback/credentials. This pre-check
  // shares its bucket and exists only to say "slow down" instead of "wrong
  // password" — the limit is doubled because a form attempt consumes one hit
  // here and one in authorize, so both layers run dry at the same 10 attempts.
  if (!rateLimit(`login:${await clientIp()}:${email}`, 20, 15 * 60e3).ok) return SLOW_DOWN;

  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
    return null; // unreachable — signIn redirects
  } catch (e) {
    // signIn's success path *throws* a redirect; let it through.
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof AuthError) return { error: "Wrong email or password." };
    console.error("login failed", e);
    return { error: "Something went wrong. Try again." };
  }
}

/**
 * Create an account with a password, then sign in. Refuses existing emails
 * outright — allowing a password to be attached to an existing account would
 * let anyone take over a magic-link-era user. Those accounts go through
 * "Forgot password?" instead, which proves inbox ownership.
 */
export async function signupAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!isEmail(email)) return { error: "Enter a valid email address." };
  const bad = validPassword(password);
  if (bad) return { error: bad };

  if (!rateLimit(`signup:${await clientIp()}`, 5, 3600e3).ok) return SLOW_DOWN;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "An account with that email already exists. Sign in — or use “Forgot password?” to set a password." };
  }

  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await db.user.create({ data: { email, passwordHash } });
  } catch (e) {
    // Only the unique-constraint race means "already exists" — anything else
    // (a dropped connection, most likely) must not masquerade as it.
    if ((e as { code?: string })?.code === "P2002") {
      return { error: "An account with that email already exists. Sign in — or use “Forgot password?” to set a password." };
    }
    console.error("signup create failed", e);
    return { error: "Something went wrong. Try again." };
  }
  await ensureOrgForUser(user.id, email);

  // Confirm the address is real and reaches its owner — reports go to it.
  // Best-effort: signup succeeds even if the mail provider is down.
  await sendVerificationEmail(email).catch((e) => console.error("verification email failed", e));

  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
    return null;
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
    // Account exists and is fine; only the auto-login failed.
    redirect("/login");
  }
}

/**
 * Request a password reset. Always claims success — whether the address has an
 * account is not something this form should reveal. Tokens are stored hashed,
 * expire in an hour, and are single-use.
 */
export async function requestResetAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!isEmail(email)) return { error: "Enter a valid email address." };

  // Also keyed on the target address: stops using this form to mail-bomb
  // someone else's inbox from many IPs... at least from one IP at a time.
  if (!rateLimit(`reset:${await clientIp()}:${email}`, 3, 3600e3).ok) return SLOW_DOWN;

  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    const token = randomBytes(32).toString("base64url");
    const identifier = `reset:${email}`;
    // One live token per address — a new request invalidates the old one.
    await db.verificationToken.deleteMany({ where: { identifier } });
    await db.verificationToken.create({
      data: { identifier, token: sha256(token), expires: new Date(Date.now() + 60 * 60 * 1000) },
    });
    const url = `${BASE()}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
    await resendSend({
      to: email,
      subject: "Set your Auramite password",
      text: [
        "Someone asked to set a password for this address on Auramite. If that was you, use this link within the hour:",
        "",
        url,
        "",
        "If it wasn't you, ignore this email — nothing changes without the link.",
        "",
        "— Auramite",
      ].join("\n"),
    });
  }

  return { ok: "If that address has an account, a reset link is on its way. It works for one hour." };
}

/** Complete a reset: verify the token, set the password, invalidate the token. */
export async function resetPasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const bad = validPassword(password);
  if (bad) return { error: bad };
  if (!isEmail(email) || !token) return { error: "That reset link is not valid. Request a new one." };

  const identifier = `reset:${email}`;
  const row = await db.verificationToken.findUnique({
    where: { identifier_token: { identifier, token: sha256(token) } },
  });
  if (!row || row.expires < new Date()) {
    return { error: "That reset link has expired or was already used. Request a new one." };
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user) return { error: "That reset link is not valid. Request a new one." };

  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
  await db.verificationToken.deleteMany({ where: { identifier } });
  // Setting a password via emailed link proves inbox ownership as thoroughly
  // as a magic link did.
  if (!user.emailVerified) {
    await db.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } }).catch(() => {});
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
    return null;
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
    redirect("/login");
  }
}

/** Change (or first-set) the password from settings, for a signed-in user. */
export async function changePasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const { auth } = await import("@/auth");
  const session = await auth();
  if (!session?.user?.id) return { error: "Sign in first." };

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("password") ?? "");
  const bad = validPassword(next);
  if (bad) return { error: bad };

  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user) return { error: "Sign in first." };

  // A user who already has a password must prove they know it — a walk-up to
  // an unlocked laptop must not be enough to change it.
  if (user.passwordHash && !(await verifyPassword(current, user.passwordHash))) {
    return { error: "Your current password is wrong." };
  }

  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
  return { ok: user.passwordHash ? "Password changed." : "Password set. You can now sign in with it." };
}

/**
 * Consume a verification link. Not a form action — called by the /verify-email
 * page on load. Idempotent: an already-verified user gets a friendly "done".
 */
export async function consumeVerifyToken(email: string, token: string): Promise<{ ok: boolean; message: string }> {
  if (!isEmail(email) || !token) return { ok: false, message: "That link is not valid." };

  const user = await db.user.findUnique({ where: { email } });
  if (!user) return { ok: false, message: "That link is not valid." };
  if (user.emailVerified) return { ok: true, message: "This address is already confirmed." };

  const identifier = `verify:${email}`;
  const row = await db.verificationToken.findUnique({
    where: { identifier_token: { identifier, token: sha256(token) } },
  });
  if (!row || row.expires < new Date()) {
    return { ok: false, message: "That link has expired or was already used. Request a new one from your dashboard." };
  }

  await db.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });
  await db.verificationToken.deleteMany({ where: { identifier } });
  return { ok: true, message: "Email confirmed — you're all set." };
}

/** Resend the confirmation email, from the signed-in banner. */
export async function resendVerificationAction(): Promise<void> {
  const { auth } = await import("@/auth");
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return;

  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.emailVerified) return;

  if (!rateLimit(`verify-resend:${email}`, 3, 3600e3).ok) return;
  await sendVerificationEmail(email).catch((e) => console.error("verification resend failed", e));
}
