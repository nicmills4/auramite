import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "./lib/db";

// Magic-link sign-in only — no passwords stored. Sends through the same Resend
// domain the rest of the product uses.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "database" },
  pages: {
    signIn: "/login",
    verifyRequest: "/login/check-email",
    error: "/login",
  },
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.AUTH_FROM_EMAIL || "Auramite <login@auramite.io>",
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
  events: {
    // Every user needs an Organization — it owns the sites and the subscription.
    // Creating it on first sign-in means the account page never has to cope with
    // a user who has none.
    async createUser({ user }) {
      if (!user.id) return;
      const org = await db.organization.create({
        data: { name: user.email ?? undefined },
      });
      await db.user.update({ where: { id: user.id }, data: { orgId: org.id } });
      // Seed the first report recipient so a new customer receives their reports
      // before touching settings. Guarded: a hiccup here must not break sign-in.
      if (user.email) {
        await db.reportRecipient
          .create({ data: { orgId: org.id, email: user.email.toLowerCase() } })
          .catch(() => {});
      }
    },
  },
});
