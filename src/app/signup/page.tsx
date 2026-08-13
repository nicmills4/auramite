import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { signupAction } from "@/lib/auth-actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwords";
import { AuthForm } from "../login/auth-form";

export const metadata: Metadata = { title: "Create your account — Auramite" };

const gold = "#e3b341";

export default async function SignupPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-20">
      <div className="w-full max-w-sm">
        <a href="/" className="mb-8 flex items-center justify-center gap-1.5">
          <span className="text-lg font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>Auramite</span>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: gold }} />
        </a>

        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
          <h1 className="text-xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>Create your account</h1>
          <p className="mt-1.5 text-sm text-zinc-400">Watch your pages and get reports the moment something leaks.</p>
          <AuthForm
            action={signupAction}
            fields={[
              { name: "email", type: "email", placeholder: "you@company.com", autoComplete: "email" },
              { name: "password", type: "password", placeholder: `Password (${MIN_PASSWORD_LENGTH}+ characters)`, autoComplete: "new-password", minLength: MIN_PASSWORD_LENGTH },
            ]}
            submitLabel="Create account"
            pendingLabel="Creating…"
          />
        </div>

        <p className="mt-5 text-center text-sm text-zinc-500">
          Already have an account? <a href="/login" className="font-medium transition hover:brightness-110" style={{ color: gold }}>Sign in</a>
        </p>
      </div>
    </main>
  );
}
