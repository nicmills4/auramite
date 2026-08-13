import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { loginAction } from "@/lib/auth-actions";
import { AuthForm } from "./auth-form";

export const metadata: Metadata = { title: "Sign in — Auramite" };

const gold = "#e3b341";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-20">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-1.5">
          <span className="text-lg font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>Auramite</span>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: gold }} />
        </Link>

        <div className="rounded-[2px] border border-white/[0.08] bg-white/[0.02] p-6">
          <h1 className="text-xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>Sign in</h1>
          <AuthForm
            action={loginAction}
            fields={[
              { name: "email", type: "email", placeholder: "you@company.com", autoComplete: "email" },
              { name: "password", type: "password", placeholder: "Password", autoComplete: "current-password" },
            ]}
            submitLabel="Sign in"
            pendingLabel="Signing in…"
          />
          <p className="mt-4 text-center text-sm">
            <a href="/forgot-password" className="text-zinc-500 transition hover:text-zinc-300">Forgot password?</a>
          </p>
        </div>

        <p className="mt-5 text-center text-sm text-zinc-500">
          New to Auramite? <a href="/signup" className="font-medium transition hover:brightness-110" style={{ color: gold }}>Create an account</a>
        </p>
        <p className="mt-2 text-center text-xs">
          <Link href="/" className="text-zinc-500 transition hover:text-zinc-300">← Back to auramite.io</Link>
        </p>
      </div>
    </main>
  );
}
