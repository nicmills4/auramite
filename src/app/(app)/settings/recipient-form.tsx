"use client";

import { useActionState, useEffect, useRef } from "react";
import { addRecipient, type AddState } from "./actions";

const gold = "#e3b341";

export function RecipientForm({ atCap, capHint }: { atCap: boolean; capHint: string }) {
  const [state, action, pending] = useActionState<AddState, FormData>(addRecipient, null);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear only on success, so a rejected address stays put to be corrected.
  useEffect(() => {
    if (state?.added) formRef.current?.reset();
  }, [state]);

  return (
    <>
      <form ref={formRef} action={action} className="flex flex-col gap-2.5 sm:flex-row">
        <input
          name="email" type="email" required placeholder="reports@yourcompany.com" disabled={atCap || pending}
          className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/[0.05] px-4 py-2.5 text-white outline-none transition placeholder:text-zinc-500 focus:border-[#e3b341] disabled:opacity-50"
        />
        <button
          type="submit" disabled={atCap || pending}
          className="shrink-0 rounded-lg px-5 py-2.5 text-sm font-semibold text-[#0b0a08] transition hover:brightness-110 disabled:opacity-50"
          style={{ background: gold }}
        >
          {pending ? "Adding…" : "Add recipient"}
        </button>
      </form>

      {state?.error && (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/[0.08] px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}
      {atCap && !state?.error && <p className="mt-3 text-xs" style={{ color: gold }}>{capHint}</p>}
    </>
  );
}
