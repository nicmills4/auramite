import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export const metadata: Metadata = { title: "Sign in — Auramite" };

const gold = "#e3b341";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/account");

  const { error } = await searchParams;

  async function sendLink(formData: FormData) {
    "use server";
    const email = String(formData.get("email") || "").trim();
    if (!email) return;
    await signIn("resend", { email, redirectTo: "/account" });
  }

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-20">
      <div className="w-full max-w-sm">
        <a href="/" className="mb-8 flex items-center justify-center gap-1.5">
          <span className="text-lg font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>Auramite</span>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: gold }} />
        </a>

        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
          <h1 className="text-xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>Sign in</h1>
          <p className="mt-1.5 text-sm text-zinc-400">
            We&apos;ll email you a sign-in link. No password to remember.
          </p>

          {error && (
            <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/[0.08] px-3 py-2 text-sm text-red-300">
              That link didn&apos;t work — it may have expired or already been used. Request a new one.
            </p>
          )}

          <form action={sendLink} className="mt-5 space-y-2.5">
            <input
              type="email" name="email" required autoComplete="email" placeholder="you@company.com"
              className="w-full rounded-lg border border-white/15 bg-white/[0.05] px-4 py-2.5 text-white outline-none transition placeholder:text-zinc-500 focus:border-[#e3b341]"
            />
            <button type="submit" className="w-full rounded-lg py-2.5 font-semibold text-[#0b0a08] transition hover:brightness-110" style={{ background: gold }}>
              Email me a link
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs text-zinc-600">
          Don&apos;t have an account yet? Signing in creates one.
        </p>
        <p className="mt-2 text-center text-xs">
          <a href="/" className="text-zinc-500 transition hover:text-zinc-300">← Back to auramite.io</a>
        </p>
      </div>
    </main>
  );
}
