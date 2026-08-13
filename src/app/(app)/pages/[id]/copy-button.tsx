"use client";

import { useState } from "react";

/** Copies the DevTools search string IT needs to re-check a finding. */
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 rounded bg-white/10 px-3 text-xs font-medium text-white transition hover:bg-white/20"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
