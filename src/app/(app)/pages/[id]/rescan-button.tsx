"use client";

import { useActionState } from "react";
import { rescanAction, type RescanState } from "./actions";

export function RescanButton({ pageId }: { pageId: string }) {
  const [state, formAction, pending] = useActionState<RescanState, FormData>(rescanAction, null);

  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="pageId" value={pageId} />
      <button
        type="submit"
        disabled={pending || Boolean(state?.ok)}
        className="rounded-lg border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-white/[0.12] disabled:cursor-default disabled:opacity-50"
      >
        {pending ? "Starting…" : state?.ok ? "Scan running" : "Rescan now"}
      </button>
      {state?.ok && <span className="text-xs text-emerald-300">{state.ok}</span>}
      {state?.error && <span className="text-xs text-amber-300">{state.error}</span>}
    </form>
  );
}
