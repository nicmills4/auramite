"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-[2px] bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 print:hidden"
    >
      Print / save as PDF
    </button>
  );
}
