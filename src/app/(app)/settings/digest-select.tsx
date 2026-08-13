"use client";

import { useRef } from "react";
import { setRecipientDigest } from "./actions";

/** Per-recipient cadence dropdown — saves on change, no separate button. */
export function DigestSelect({ recipientId, value }: { recipientId: string; value: string }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form action={setRecipientDigest} ref={ref}>
      <input type="hidden" name="recipientId" value={recipientId} />
      <select
        name="digest"
        defaultValue={value}
        onChange={() => ref.current?.requestSubmit()}
        className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-zinc-300 outline-none transition hover:border-white/20 focus:border-[#e3b341]/50"
        aria-label="Report frequency"
      >
        <option value="EVERY_SCAN">Every scan</option>
        <option value="WEEKLY">Weekly summary</option>
      </select>
    </form>
  );
}
