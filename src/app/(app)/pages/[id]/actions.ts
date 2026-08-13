"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { scanAndRecord } from "@/lib/monitor-core";
import { rateLimit } from "@/lib/rate-limit";

export type RescanState = { error?: string; ok?: string } | null;

/**
 * "I just deployed the fix — check now." Runs one real scan of one page and
 * persists it like any scheduled run, but sends no email: the customer is
 * sitting right here watching the page. Fire-and-forget for the same reason
 * as the admin test button — a scan outlives any sane request timeout.
 */
export async function rescanAction(_prev: RescanState, formData: FormData): Promise<RescanState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Sign in first." };

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { org: { select: { id: true } } },
  });
  if (!user?.org) return { error: "Sign in first." };

  const pageId = String(formData.get("pageId") || "");
  // Org-scoped: a forged id from another tenant is indistinguishable from a
  // page that never existed.
  const page = await db.page.findFirst({
    where: { id: pageId, site: { orgId: user.org.id }, enabled: true },
    include: {
      site: { select: { orgId: true } },
      // Diff baseline: the last SUCCESSFUL scan, same as scheduled runs.
      scans: { where: { ok: true }, orderBy: { ranAt: "desc" }, take: 1 },
    },
  });
  if (!page) return { error: "Page not found (or monitoring is paused)." };

  // Per page, not per user: two people at one customer hammering the button
  // still costs us one Chromium run per 10 minutes.
  const rl = rateLimit(`rescan:${page.id}`, 1, 10 * 60e3);
  if (!rl.ok) {
    const mins = Math.max(1, Math.ceil(rl.retryAfterMs / 60e3));
    return { error: `Recently scanned — try again in ~${mins} min.` };
  }

  void (async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      await scanAndRecord(browser, {
        id: page.id,
        url: page.url,
        label: page.label,
        cadence: page.cadence,
        lastScanAt: page.lastScanAt,
        site: { orgId: page.site.orgId },
        scans: page.scans,
      });
    } catch (e) {
      console.error("rescan failed", e);
    } finally {
      await browser.close().catch(() => {});
    }
  })();

  return { ok: "Scan started — results land here in about half a minute. Refresh to see them." };
}
