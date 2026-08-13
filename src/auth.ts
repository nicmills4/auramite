import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "./lib/db";
import { verifyPassword } from "./lib/passwords";

/**
 * Email + password sign-in. Sessions are JWTs — the Credentials provider does
 * not persist database sessions, and this is the standard pairing for it.
 * The adapter stays for user records; the Session table is simply unused now.
 *
 * Accounts from the magic-link era have no passwordHash; the password-reset
 * flow (src/app/(auth) pages) is how they set their first one.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        const user = await db.user.findUnique({ where: { email } });
        // Same null for unknown email and wrong password — no account probing.
        // verifyPassword is constant-time on the comparison and returns false
        // for users who have never set a password.
        if (!user || !(await verifyPassword(password, user.passwordHash))) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
