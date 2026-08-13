"use client";

import { useActionState } from "react";
import type { AuthFormState } from "@/lib/auth-actions";

const gold = "#e3b341";
const inputCls =
  "w-full rounded-lg border border-white/15 bg-white/[0.05] px-4 py-2.5 text-white outline-none transition placeholder:text-zinc-500 focus:border-[#e3b341]";

type Field = { name: string; type: string; placeholder: string; autoComplete?: string; minLength?: number };

/** One client form for every auth surface — fields differ, chrome doesn't. */
export function AuthForm({
  action,
  fields,
  submitLabel,
  pendingLabel,
  hidden = {},
}: {
  action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  fields: Field[];
  submitLabel: string;
  pendingLabel: string;
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(action, null);

  return (
    <>
      <form action={formAction} className="mt-5 space-y-2.5">
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {fields.map((f) => (
          <input
            key={f.name}
            name={f.name}
            type={f.type}
            required
            placeholder={f.placeholder}
            autoComplete={f.autoComplete}
            minLength={f.minLength}
            className={inputCls}
          />
        ))}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg py-2.5 font-semibold text-[#0b0a08] transition hover:brightness-110 disabled:opacity-60"
          style={{ background: gold }}
        >
          {pending ? pendingLabel : submitLabel}
        </button>
      </form>
      {state?.error && (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/[0.08] px-3 py-2 text-sm text-red-300">{state.error}</p>
      )}
      {state?.ok && (
        <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] px-3 py-2 text-sm text-emerald-200">{state.ok}</p>
      )}
    </>
  );
}
