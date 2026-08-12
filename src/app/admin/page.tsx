import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { PLANS, planFor } from "@/lib/plans";
import { setSubscription, removeOrgPage } from "./actions";
import { CreateCustomerForm, TestScanButton, AddPageForm, DeleteOrgForm } from "./forms";

export const dynamic = "force-dynamic";

const gold = "#e3b341";
const card = "rounded-2xl border border-white/[0.08] bg-white/[0.02]";
const eyebrow = "font-mono text-[11px] uppercase tracking-[0.2em]";

const STATUSES = ["ACTIVE", "TRIALING", "PAST_DUE", "CANCELED", "INCOMPLETE"] as const;
const BILLABLE = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);

const fmt = (d: Date | null | undefined) =>
  d ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC" : "never";

export default async function AdminPage() {
  await requireAdmin();

  const orgs = await db.organization.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      users: { select: { email: true } },
      subscription: true,
      reportRecipients: { select: { id: true, email: true } },
      sites: {
        orderBy: { host: "asc" },
        include: {
          pages: {
            orderBy: { createdAt: "asc" },
            include: { scans: { orderBy: { ranAt: "desc" }, take: 1, select: { ranAt: true, ok: true, verdict: true, highCount: true } } },
          },
        },
      },
    },
  });

  const testInbox = process.env.ADMIN_TEST_EMAIL || process.env.LEAD_NOTIFY_EMAIL || null;
  const suggestedEmail = `test+${Date.now().toString(36)}@auramite.io`;
  const billableCount = orgs.filter((o) => o.subscription && BILLABLE.has(o.subscription.status)).length;
  const pageCount = orgs.reduce((n, o) => n + o.sites.reduce((m, s) => m + s.pages.length, 0), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <div>
        <p className={eyebrow} style={{ color: gold }}>Admin</p>
        <h1 className="mt-2 text-2xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>Subscribers</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {orgs.length} organization{orgs.length === 1 ? "" : "s"} · {billableCount} billable · {pageCount} page{pageCount === 1 ? "" : "s"} tracked
        </p>
      </div>

      {!testInbox && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] p-4 text-sm text-amber-200">
          Neither <span className="font-mono">ADMIN_TEST_EMAIL</span> nor <span className="font-mono">LEAD_NOTIFY_EMAIL</span> is set,
          so test scans have nowhere safe to deliver. Set one before running a scan.
        </div>
      )}

      <section className={`${card} p-6`}>
        <p className={`${eyebrow} mb-1`} style={{ color: gold }}>Simulate a customer</p>
        <p className="mb-4 text-sm text-zinc-500">
          Creates the user, organization, report recipient, subscription and first page together. The
          subscription is written directly, not through Stripe — this is for exercising the pipeline, not billing.
        </p>
        <CreateCustomerForm defaultEmail={suggestedEmail} />
      </section>

      {orgs.length === 0 ? (
        <div className={`${card} p-8 text-center text-sm text-zinc-500`}>No organizations yet.</div>
      ) : (
        <div className="space-y-4">
          {orgs.map((org) => {
            const pages = org.sites.flatMap((s) => s.pages);
            const sub = org.subscription;
            const spec = sub ? planFor(sub.plan) : null;
            const billable = sub && BILLABLE.has(sub.status);
            const lastScan = pages
              .map((p) => p.scans[0])
              .filter(Boolean)
              .sort((a, b) => b!.ranAt.getTime() - a!.ranAt.getTime())[0];
            const simulated = sub?.stripeSubscriptionId.startsWith("sub_admin_test_");

            return (
              <section key={org.id} className={`${card} p-6`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-semibold text-white">{org.name || org.id}</h2>
                      {billable
                        ? <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">{sub!.status}</span>
                        : <span className="rounded-full bg-zinc-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-400">{sub?.status ?? "NO PLAN"}</span>}
                      {simulated && <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">simulated</span>}
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-zinc-600">{org.id}</p>
                    <p className="mt-1.5 text-sm text-zinc-500">
                      {spec ? `${spec.name} · ${spec.cadence === "DAILY" ? "daily" : "weekly"} · up to ${spec.pageLimit} pages` : "No subscription"}
                      {" · "}last scan {fmt(lastScan?.ranAt)}
                    </p>
                    <p className="mt-1 text-xs text-zinc-600">
                      members: {org.users.map((u) => u.email).join(", ") || "none"} · reports to:{" "}
                      <span className="text-zinc-400">{org.reportRecipients.map((r) => r.email).join(", ") || "(falls back to members)"}</span>
                    </p>
                  </div>
                  <TestScanButton orgId={org.id} pageCount={billable ? pages.filter((p) => p.enabled).length : 0} />
                </div>

                <div className="mt-5 grid gap-5 lg:grid-cols-2">
                  <div>
                    <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-zinc-500">Subscription</p>
                    <form action={setSubscription} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="orgId" value={org.id} />
                      <select name="plan" defaultValue={sub?.plan ?? "GROWTH"}
                        className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-2 text-sm text-white outline-none focus:border-[#e3b341]">
                        {PLANS.map((p) => <option key={p.plan} value={p.plan}>{p.name}</option>)}
                      </select>
                      <select name="status" defaultValue={sub?.status ?? "ACTIVE"}
                        className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-2 text-sm text-white outline-none focus:border-[#e3b341]">
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button type="submit" className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white transition hover:bg-white/[0.06]">
                        Apply
                      </button>
                    </form>
                    <p className="mt-2 text-xs text-zinc-600">
                      Changing the plan realigns page cadence, same as the Stripe webhook does.
                    </p>
                  </div>

                  <div>
                    <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-zinc-500">Pages ({pages.length})</p>
                    {pages.length > 0 && (
                      <ul className="mb-2 divide-y divide-white/[0.06]">
                        {pages.map((p) => (
                          <li key={p.id} className="flex items-center gap-3 py-2">
                            <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{p.url}</span>
                            <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                              {p.enabled ? p.cadence.toLowerCase() : "paused"} · {p.scans[0] ? (p.scans[0].ok ? `${p.scans[0].highCount} high` : "failed") : "unscanned"}
                            </span>
                            <form action={removeOrgPage}>
                              <input type="hidden" name="pageId" value={p.id} />
                              <button type="submit" className="rounded border border-white/10 px-2 py-1 text-[10px] text-zinc-500 transition hover:border-red-500/40 hover:text-red-300">
                                remove
                              </button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    )}
                    <AddPageForm orgId={org.id} />
                  </div>
                </div>

                <div className="mt-5 border-t border-white/[0.06] pt-4">
                  <DeleteOrgForm orgId={org.id} label={org.name || org.id} />
                  <p className="mt-2 text-xs text-zinc-600">Cascades to sites, pages and scan history. Not recoverable.</p>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
