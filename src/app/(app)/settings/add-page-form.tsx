"use client";

import { useActionState, useEffect, useRef } from "react";
import { addPage, type AddState } from "./actions";

const gold = "#e3b341";

export function AddPageForm({
  atLimit,
  limitHint,
}: {
  atLimit: boolean;
  limitHint: string;
}) {
  const [state, action, pending] = useActionState<AddState, FormData>(addPage, null);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the inputs only on a successful add, so a rejected URL stays put for
  // the user to correct rather than vanishing.
  useEffect(() => {
    if (state?.added) formRef.current?.reset();
  }, [state]);

  return (
    <>
      <form ref={formRef} action={action} className="flex flex-col gap-2.5 sm:flex-row">
        <input
          name="url" type="text" required placeholder="yourcompany.com/checkout" disabled={atLimit || pending}
          className="min-w-0 flex-1 rounded-[2px] border border-white/15 bg-white/[0.05] px-4 py-2.5 text-white outline-none transition placeholder:text-zinc-500 focus:border-[#e3b341] disabled:opacity-50"
        />
        <input
          name="label" type="text" placeholder="Label (optional)" disabled={atLimit || pending}
          className="rounded-[2px] border border-white/15 bg-white/[0.05] px-4 py-2.5 text-white outline-none transition placeholder:text-zinc-500 focus:border-[#e3b341] disabled:opacity-50 sm:w-44"
        />
        <button
          type="submit" disabled={atLimit || pending}
          className="shrink-0 rounded-[2px] px-5 py-2.5 text-sm font-semibold text-[#0b0a08] transition hover:brightness-110 disabled:opacity-50"
          style={{ background: gold }}
        >
          {pending ? "Adding…" : "Add page"}
        </button>
      </form>

      {state?.error && (
        <p className="mt-3 rounded-[2px] border border-red-500/30 bg-red-500/[0.08] px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}
      {atLimit && !state?.error && (
        <p className="mt-3 text-xs" style={{ color: gold }}>{limitHint}</p>
      )}
    </>
  );
}
