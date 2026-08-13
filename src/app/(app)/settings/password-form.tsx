"use client";

import { useActionState, useEffect, useRef } from "react";
import { changePasswordAction, type AuthFormState } from "@/lib/auth-actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwords";

const gold = "#e3b341";
const inputCls =
  "w-full rounded-lg border border-white/15 bg-white/[0.05] px-4 py-2.5 text-white outline-none transition placeholder:text-zinc-500 focus:border-[#e3b341]";

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(changePasswordAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <>
      <form ref={formRef} action={action} className="space-y-2.5">
        {hasPassword && (
          <input name="current" type="password" required placeholder="Current password" autoComplete="current-password" className={inputCls} />
        )}
        <input
          name="password" type="password" required minLength={MIN_PASSWORD_LENGTH}
          placeholder={`New password (${MIN_PASSWORD_LENGTH}+ characters)`} autoComplete="new-password" className={inputCls}
        />
        <button
          type="submit" disabled={pending}
          className="w-full rounded-lg py-2.5 text-sm font-semibold text-[#0b0a08] transition hover:brightness-110 disabled:opacity-60"
          style={{ background: gold }}
        >
          {pending ? "Saving…" : hasPassword ? "Change password" : "Set password"}
        </button>
      </form>
      {state?.error && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/[0.08] px-3 py-2 text-sm text-red-300">{state.error}</p>}
      {state?.ok && <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] px-3 py-2 text-sm text-emerald-200">{state.ok}</p>}
    </>
  );
}
