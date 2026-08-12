import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { PLANS, planFor } from "@/lib/plans";
import { removePage, togglePage } from "./actions";
import { AddPageForm } from "./add-page-form";
import { CheckoutButton, PortalButton } from "./billing-buttons";
import { gold, card, eyebrow, fmtDate } from "../ui";

export const metadata: Metadata = { title: "Settings — Auramite" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  ACTIVE: { text: "Active", cls: "bg-emerald-500/15 text-emerald-300" },
  TRIALING: { text: "Trialing", cls: "bg-emerald-500/15 text-emerald-300" },
  PAST_DUE: { text: "Payment failed", cls: "bg-red-500/15 text-red-300" },
  CANCELED: { text: "Canceled", cls: "bg-zinc-500/15 text-zinc-400" },
  INCOMPLETE: { text: "Incomplete", cls: "bg-amber-500/15 text-amber-300" },
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { checkout } = await searchParams;

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: {
      org: {
        include: {
          subscription: true,
          sites: { include: { pages: { orderBy: { createdAt: "asc" } } }, orderBy: { host: "asc" } },
        },
      },
    },
  });
  if (!user?.org) redirect("/login");

  const sub = user.org.subscription;
  const active = sub && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(sub.status);
  const spec = active && sub ? planFor(sub.plan) : null;
  const pageLimit = spec?.pageLimit ?? 1;
  const pages = user.org.sites.flatMap((s) => s.pages.map((p) => ({ ...p, host: s.host })));
  const atLimit = pages.length >= pageLimit;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-12">
        {checkout === "success" && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.07] p-4 text-sm text-emerald-200">
            Payment received. Your subscription may take a few seconds to appear here while Stripe confirms it.
          </div>
        )}
        {checkout === "cancelled" && (
          <div className={`${card} p-4 text-sm text-zinc-400`}>Checkout cancelled — nothing was charged.</div>
        )}

        {/* ---- subscription ---- */}
        <section className="space-y-4">
          <p className={eyebrow} style={{ color: gold }}>Subscription</p>

          {active && sub && spec ? (
            <div className={`${card} p-6`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>{spec.name}</h2>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_LABEL[sub.status]?.cls}`}>
                      {STATUS_LABEL[sub.status]?.text ?? sub.status}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-zinc-400">
                    {spec.price}{spec.per} · {spec.cadence === "DAILY" ? "Daily" : "Weekly"} scans · up to {spec.pageLimit} pages
                  </p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {sub.cancelAtPeriodEnd
                      ? `Ends ${fmtDate(sub.currentPeriodEnd)} — you keep access until then.`
                      : `Renews ${fmtDate(sub.currentPeriodEnd)}.`}
                  </p>
                </div>
                <PortalButton />
              </div>

              {sub.status === "PAST_DUE" && (
                <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/[0.08] px-3 py-2 text-sm text-red-300">
                  Your last payment failed. Update your card in the billing portal to keep scans running.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className={`${card} p-6`}>
                <h2 className="text-lg font-semibold text-white" style={{ fontFamily: "var(--font-display)" }}>No active plan</h2>
                <p className="mt-1.5 text-sm text-zinc-400">
                  Pick a plan to start scheduled scanning. You can track one page in the meantime.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {PLANS.map((p) => (
                  <div key={p.plan} className={`flex flex-col rounded-2xl border p-6 bg-white/[0.02] ${p.hot ? "border-[#e3b341]/40 ring-1 ring-[#e3b341]/20" : "border-white/[0.08]"}`}>
                    <div className="flex items-baseline justify-between">
                      <h3 className="font-semibold text-white">{p.name}</h3>
                      {p.hot && <span className="font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: gold }}>Most popular</span>}
                    </div>
                    <p className="mt-3 text-3xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>
                      {p.price}<span className="text-base font-normal text-zinc-500">{p.per}</span>
                    </p>
                    <p className="text-sm text-zinc-500">{p.tag}</p>
                    <ul className="mt-5 space-y-2 text-sm text-zinc-300">
                      {p.feats.map((f) => (
                        <li key={f} className="flex gap-2">
                          <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden>
                            <path d="M4 10.5l4 4 8-9" stroke={gold} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto">
                      <CheckoutButton plan={p.name} hot={p.hot} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* ---- pages under watch ---- */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <p className={eyebrow} style={{ color: gold }}>Pages we watch</p>
            <span className="font-mono text-xs text-zinc-500">{pages.length} / {pageLimit}</span>
          </div>

          <div className={`${card} p-6`}>
            <AddPageForm
              atLimit={atLimit}
              limitHint={
                active
                  ? `You've used all ${pageLimit} pages on ${spec?.name}. Upgrade in the billing portal to track more.`
                  : `Free accounts track ${pageLimit} page. Pick a plan above to track more.`
              }
            />

            {pages.length === 0 ? (
              <p className="mt-6 text-sm text-zinc-500">
                Nothing here yet. Add the pages that matter most — your homepage, top landing pages, and checkout.
              </p>
            ) : (
              <ul className="mt-6 divide-y divide-white/[0.06]">
                {pages.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`truncate text-sm ${p.enabled ? "text-zinc-100" : "text-zinc-500 line-through"}`}>{p.url}</span>
                        {p.label && <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-zinc-400">{p.label}</span>}
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-zinc-600">
                        {p.cadence === "DAILY" ? "Daily" : "Weekly"} · last scanned {p.lastScanAt ? fmtDate(p.lastScanAt) : "never"}
                      </p>
                    </div>
                    <form action={togglePage}>
                      <input type="hidden" name="pageId" value={p.id} />
                      <button type="submit" className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-400 transition hover:text-white">
                        {p.enabled ? "Pause" : "Resume"}
                      </button>
                    </form>
                    <form action={removePage}>
                      <input type="hidden" name="pageId" value={p.id} />
                      <button type="submit" className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-500 transition hover:border-red-500/40 hover:text-red-300">
                        Remove
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
    </div>
  );
}
