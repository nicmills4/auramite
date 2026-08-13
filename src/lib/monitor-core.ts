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
  /** Plain-English findings for the report — the emails never show raw verdicts. */
  findings?: { severity: string; title: string }[];
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
              reportRecipients: { select: { email: true, digest: true, lastSentAt: true } },
            },
          },
        },
      },
      // The diff baseline is the last SUCCESSFUL scan. An unreachable day must
      // not swallow a leak that appeared during the gap — failures are
      // annotations, not resets.
      scans: { where: { ok: true }, orderBy: { ranAt: "desc" }, take: 1 },
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
    // No robots.txt check here on purpose: this page is watched because its
    // owner subscribed and asked us to watch it. Authority comes from that
    // agreement, and a crawler-directed file is not how it would be withdrawn.
    // The uninvited prospecting CLIs do respect robots.txt — see scanOne.
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

    const summarized = (explainers as { severity: string; title: string }[]).map((e) => ({
      severity: e.severity,
      title: e.title,
    }));
    return { orgId, url: page.url, label: page.label, host, verdict: scan.verdict as string, findings: summarized, firstRun, diff };
  } catch (e) {
    const error = cleanError(e);
    await db.scan.create({ data: { pageId: page.id, ok: false, error, verdict: null } }).catch(() => {});
    await db.page.update({ where: { id: page.id }, data: { lastScanAt: new Date() } }).catch(() => {});
    return { orgId, url: page.url, label: page.label, host, error };
  }
}

type Candidates = Awaited<ReturnType<typeof findDuePages>>["candidates"];

const WEEKLY_WINDOW_MS = 6.5 * 24 * 3600e3; // a shade under 7 days so a weekly cron never skips

/**
 * Who receives an org's report this run. Single source of truth so the CLI and
 * the admin panel cannot address different people for the same organization.
 *
 * Digest policy: EVERY_SCAN recipients always receive. WEEKLY recipients are
 * quieted for no-change reports inside their window — but anything NEW always
 * sends immediately; a digest setting must never delay an alert.
 */
export function recipientsForOrg(candidates: Candidates, orgId: string, results?: PageResult[]): string[] {
  const org = candidates.find((p) => p.site.orgId === orgId)?.site.org;
  const rows = org?.reportRecipients ?? [];

  // Fallback to members' login addresses is a safety net for an org the
  // backfill somehow missed — a customer must never silently stop receiving
  // the reports they pay for.
  if (rows.length === 0) {
    return [...new Set((org?.users.map((u) => u.email) ?? []).map((e) => e.toLowerCase()))];
  }

  const hasNews = (results ?? []).some((r) => !r.error && !r.firstRun && (r.diff?.added?.length ?? 0) > 0);
  const now = Date.now();
  const due = rows.filter((r) => {
    if (r.digest !== "WEEKLY") return true;
    if (hasNews) return true;
    if (!r.lastSentAt) return true;
    return now - r.lastSentAt.getTime() >= WEEKLY_WINDOW_MS;
  });
  return [...new Set(due.map((r) => r.email.toLowerCase()))];
}

/** One report per organization, covering every page scanned for it this run. */
export async function reportByOrg(
  results: PageResult[],
  recipientsFor: (orgId: string, pages: PageResult[]) => string[],
  ranAt: string,
  redirectTo?: string,
) {
  const byOrg = new Map<string, PageResult[]>();
  for (const r of results) {
    if (!byOrg.has(r.orgId)) byOrg.set(r.orgId, []);
    byOrg.get(r.orgId)!.push(r);
  }
  for (const [orgId, pages] of byOrg) {
    const to = recipientsFor(orgId, pages);
    if (!to.length) continue;
    await sendOrgReport({ to, pages, ranAt, redirectTo });
    // Stamp the weekly window only on real deliveries — a dry run or a
    // redirected admin test must not consume a customer's digest window.
    if (!redirectTo && process.env.DRY_RUN !== "1") {
      await db.reportRecipient
        .updateMany({ where: { orgId, email: { in: to } }, data: { lastSentAt: new Date() } })
        .catch(() => {});
    }
  }
  return byOrg;
}
