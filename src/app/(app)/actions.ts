"use server";

import { signOut } from "@/auth";

/**
 * Lands on the marketing site, which is correct here — after a real sign-out,
 * a nav showing "Sign in" is the truth. (The bug this replaces was the logo
 * sending a still-signed-in user there and making it look like a sign-out.)
 */
export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
