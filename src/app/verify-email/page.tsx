import type { Metadata } from "next";
import Link from "next/link";
import { consumeVerifyToken } from "@/lib/auth-actions";

export const metadata: Metadata = { title: "Confirm your email — Auramite", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Landing page for the emailed confirmation link. Consumes the token on load —
 * the link is single-use and proves inbox ownership by itself, so there is
 * nothing further to ask the visitor.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { token, email } = await searchParams;
  const result = await consumeVerifyToken((email ?? "").toLowerCase(), token ?? "");

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-6">
      <div className="w-full max-w-md rounded-[2px] border border-white/10 bg-white/[0.03] p-8 text-center">
        <p
          className={`text-lg font-semibold ${result.ok ? "text-emerald-300" : "text-amber-300"}`}
          style={{ fontFamily: "var(--font-display)" }}
        >
          {result.ok ? "Email confirmed" : "Link problem"}
        </p>
        <p className="mt-2 text-sm text-zinc-400">{result.message}</p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block rounded-[2px] px-5 py-2.5 text-sm font-semibold text-black transition hover:opacity-90"
          style={{ background: "#e3b341" }}
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
