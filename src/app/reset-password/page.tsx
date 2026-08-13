import type { Metadata } from "next";
import { resetPasswordAction } from "@/lib/auth-actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwords";
import { AuthForm } from "../login/auth-form";

export const metadata: Metadata = { title: "Choose a new password — Auramite" };

const gold = "#e3b341";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { token, email } = await searchParams;
  const linkOk = Boolean(token && email);

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-20">
      <div className="w-full max-w-sm">
        <a href="/" className="mb-8 flex items-center justify-center gap-1.5">
          <span className="text-lg font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>Auramite</span>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: gold }} />
        </a>

        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
          <h1 className="text-xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>Choose a new password</h1>
          {linkOk ? (
            <>
              <p className="mt-1.5 text-sm text-zinc-400">Setting a password for <span className="text-zinc-200">{email}</span>.</p>
              <AuthForm
                action={resetPasswordAction}
                hidden={{ token: token!, email: email! }}
                fields={[{ name: "password", type: "password", placeholder: `New password (${MIN_PASSWORD_LENGTH}+ characters)`, autoComplete: "new-password", minLength: MIN_PASSWORD_LENGTH }]}
                submitLabel="Set password and sign in"
                pendingLabel="Saving…"
              />
            </>
          ) : (
            <p className="mt-1.5 text-sm text-zinc-400">
              This reset link is incomplete. <a href="/forgot-password" className="font-medium" style={{ color: gold }}>Request a new one.</a>
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
