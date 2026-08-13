import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { resendVerificationAction } from "@/lib/auth-actions";
import { signOutAction } from "./actions";
import { NavLinks } from "./nav-links";
import { gold } from "./ui";

/**
 * Chrome for the signed-in surface. The gate here is UX — layouts persist
 * across soft navigations and do not re-run per page, so each page keeps its
 * own auth check as the actual security boundary.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // Nag (gently) until the address is confirmed — reports go to it, so an
  // unreachable login email means a customer paying for reports they never see.
  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { emailVerified: true },
  });
  const unverified = me ? !me.emailVerified : false;

  return (
    <main className="flex-1 text-zinc-300">
      <nav className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#0b0a08]/80 backdrop-blur-md print:hidden">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-8">
            {/* Home for a signed-in customer is their dashboard, not the
                marketing page — landing there looks like being signed out. */}
            <a href="/dashboard" className="flex items-center gap-1.5">
              <span className="text-lg font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>
                Auramite
              </span>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: gold }} />
            </a>
            <div className="flex items-center gap-5 text-[13px] sm:gap-6">
              <NavLinks />
            </div>
          </div>
          <div className="flex items-center gap-5 text-[13px] text-zinc-500">
            <span className="hidden sm:inline">{session.user.email}</span>
            <form action={signOutAction}>
              <button type="submit" className="transition hover:text-zinc-200">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </nav>
      {unverified && (
        <div className="border-b border-amber-500/20 bg-amber-500/[0.08] print:hidden">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2 text-[13px] text-amber-200">
            <span>Confirm your email address — we sent a link to {session.user.email}.</span>
            <form action={resendVerificationAction}>
              <button type="submit" className="font-semibold underline underline-offset-2 transition hover:text-amber-100">
                Resend the link
              </button>
            </form>
          </div>
        </div>
      )}
      {children}
    </main>
  );
}
