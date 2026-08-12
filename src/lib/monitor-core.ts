import type { Browser } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { db } from "./db";
// The scan engine and report templates are shared with the CLI tools and stay
// as .mjs; Next loads them from node_modules at runtime via serverExternalPackages.
import { scanOne, hostOf } from "../../lib/scanner.mjs";
import { buildExplainers } from "../../lib/explainers.mjs";
import { renderProofPage } from "../../lib/proofpage.mjs";
import { signalsOf, diffSignals } from "../../lib/diff.mjs";
import { sendOrgReport } from "../../lib/notify.mjs";

export const CADENCE_MS = { DAILY: 24 * 3600e3, WEEKLY: 7 * 24 * 3600e3 } as const;
export const GRACE_MS = 3600e3; // run an hour early rather than slipping a whole cycle
// PAST_DUE keeps scanning: those customers are inside Stripe's retry window, and
// cutting monitoring the moment a card expires is the wrong response.
export const BILLABLE = ["ACTIVE", "TRIALING", "PAST_DUE"] as const;

export type PageResult = {
  orgId: string;
  url: string;
  label: string | null;
  host: string;
  verdict?: string;
  firstRun?: boolean;
  diff?: { added: string[]; resolved: string[] };
  error?: string;
};

/**
 * Playwright errors carry a multi-line call log with ANSI colour codes, which
 * renders as garbage in a plain-text email. Keep the first meaningful line.
 */
export function cleanError(e: unknown): string {
  const raw = String((e as Error)?.message ?? e);
  // The escape byte is optional: Playwright leaves a bare "[2m" form behind as
  // well as real escape sequences.
  const line = raw
    .replace(/\x1b?\[[0-9;]*m/g, "")
    .split("\n")[0]
    .trim();
  return line.length > 160 ? line.slice(0, 157) + "…" : line;
}

type DuePage = {
  id: string;
  url: string;
  label: string | null;
  cadence: keyof typeof CADENCE_MS;
  lastScanAt: Date | null;
  site: { orgId: string };
  scans: { signals: unknown }[];
};

/** Which enabled pages of billable orgs are due, honouring each page's cadence. */
export async function findDuePages(opts: { force?: boolean; orgId?: string } = {}) {
  const candidates = await db.page.findMany({
    where: {
      enabled: true,
      site: {
        ...(opts.orgId ? { orgId: opts.orgId } : {}),
        org: { subscription: { status: { in: [...BILLABLE] } } },
      },
    },
    include: {
      site: {
        include: {
          org: {
            include: {
              users: { select: { email: true } },
              reportRecipients: { select: { email: true } },
            },
          },
        },
      },
      // Only the previous scan is needed — it holds the signals to diff against.
      scans: { orderBy: { ranAt: "desc" }, take: 1 },
    },
  });

  const now = Date.now();
  const due = candidates.filter((p) => {
    if (opts.force || !p.lastScanAt) return true;
    const interval = CADENCE_MS[p.cadence] ?? CADENCE_MS.WEEKLY;
    return now - p.lastScanAt.getTime() >= interval - GRACE_MS;
  });

  return { candidates, due };
}

/**
 * Scan one page, diff it against its previous scan, and persist both the result
 * and the new signal snapshot. Failures are recorded as scan rows rather than
 * skipped, so a persistently unreachable page stays visible.
 */
export async function scanAndRecord(browser: Browser, page: DuePage): Promise<PageResult> {
  const host = hostOf(page.url);
  const orgId = page.site.orgId;

  try {
    const scan = (await scanOne(browser, page.url, { sendGPC: true, writeReports: false })) as Record<string, unknown>;
    if (scan.loadError) throw new Error(`couldn't load the page — ${cleanError(scan.loadError)}`);

    const explainers = buildExplainers(scan);
    const signals: string[] = signalsOf(scan);
    const prev = page.scans[0];
    const firstRun = !prev?.signals;
    const diff = firstRun
      ? { added: [], resolved: [] }
      : diffSignals((prev!.signals as string[]) ?? [], signals);

    const hard = (scan.hardSaleShare ?? []) as { t?: number }[];
    await db.scan.create({
      data: {
        pageId: page.id,
        verdict: scan.verdict as string,
        highCount: (scan.highCount as number) || 0,
        findingCount: explainers.length,
        bannerMs: (scan.bannerMs as number) ?? null,
        firstShareMs: hard.length ? Math.min(...hard.map((t) => t.t || 0)) : null,
        findings: explainers,
        signals,
      },
    });
    await db.page.update({ where: { id: page.id }, data: { lastScanAt: new Date() } });

    try {
      const dir = join("customers", host);
      await mkdir(dir, { recursive: true });
      const { html } = renderProofPage(scan, host);
      await writeFile(join(dir, "proof.html"), html);
    } catch {
      // Proof pages are a convenience; a read-only filesystem must not fail the scan.
    }

    return { orgId, url: page.url, label: page.label, host, verdict: scan.verdict as string, firstRun, diff };
  } catch (e) {
    const error = cleanError(e);
    await db.scan.create({ data: { pageId: page.id, ok: false, error, verdict: null } }).catch(() => {});
    await db.page.update({ where: { id: page.id }, data: { lastScanAt: new Date() } }).catch(() => {});
    return { orgId, url: page.url, label: page.label, host, error };
  }
}

type Candidates = Awaited<ReturnType<typeof findDuePages>>["candidates"];

/**
 * Who receives an org's report. Single source of truth so the CLI and the admin
 * panel cannot address different people for the same organization.
 */
export function recipientsForOrg(candidates: Candidates, orgId: string): string[] {
  const org = candidates.find((p) => p.site.orgId === orgId)?.site.org;
  // Configured recipients win. Falling back to members' login addresses is a
  // safety net for an org the backfill somehow missed — a customer must never
  // silently stop receiving the reports they pay for.
  const configured = org?.reportRecipients.map((r) => r.email) ?? [];
  const emails = configured.length ? configured : (org?.users.map((u) => u.email) ?? []);
  return [...new Set(emails.map((e) => e.toLowerCase()))];
}

/** One report per organization, covering every page scanned for it this run. */
export async function reportByOrg(
  results: PageResult[],
  recipientsFor: (orgId: string) => string[],
  ranAt: string,
  redirectTo?: string,
) {
  const byOrg = new Map<string, PageResult[]>();
  for (const r of results) {
    if (!byOrg.has(r.orgId)) byOrg.set(r.orgId, []);
    byOrg.get(r.orgId)!.push(r);
  }
  for (const [orgId, pages] of byOrg) {
    await sendOrgReport({ to: recipientsFor(orgId), pages, ranAt, redirectTo });
  }
  return byOrg;
}
