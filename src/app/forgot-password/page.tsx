import type { Metadata } from "next";
import { requestResetAction } from "@/lib/auth-actions";
import { AuthForm } from "../login/auth-form";

export const metadata: Metadata = { title: "Reset your password — Auramite" };

const gold = "#e3b341";

export default function ForgotPasswordPage() {
  return (
    <main className="flex-1 flex items-center justify-center px-6 py-20">
      <div className="w-full max-w-sm">
        <a href="/" className="mb-8 flex items-center justify-center gap-1.5">
          <span className="text-lg font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>Auramite</span>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: gold }} />
        </a>

        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
          <h1 className="text-xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>Reset your password</h1>
          <p className="mt-1.5 text-sm text-zinc-400">
            We&apos;ll email you a link to set a new one. This is also how you set your first password if you joined before passwords existed.
          </p>
          <AuthForm
            action={requestResetAction}
            fields={[{ name: "email", type: "email", placeholder: "you@company.com", autoComplete: "email" }]}
            submitLabel="Email me a reset link"
            pendingLabel="Sending…"
          />
        </div>

        <p className="mt-5 text-center text-xs">
          <a href="/login" className="text-zinc-500 transition hover:text-zinc-300">← Back to sign in</a>
        </p>
      </div>
    </main>
  );
}
