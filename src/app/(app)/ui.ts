// Shared tokens for the signed-in surface, so the layout, dashboard and
// settings pages stop each carrying their own copy.
export const gold = "#e3b341";
/** Machined 2px edge, matching the marketing surface — see the note in page.tsx. */
export const card = "rounded-[2px] border border-white/[0.09] bg-white/[0.015]";
export const rule = "border-t border-white/[0.09]";
export const eyebrow = "font-mono text-[11px] uppercase tracking-[0.2em]";

export const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";

/** Always UTC — a server-locale timestamp means two people read different times. */
export const fmtDateTime = (d: Date) =>
  d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }) + " UTC";
