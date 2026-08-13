import { NextResponse } from "next/server";
import { chromium } from "playwright";
import { resendSend, isEmail } from "../../../lib/email";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import type { ScanData, Explainer } from "@/lib/scan-types";

export const runtime = "nodejs";

const NOTIFY_TO = process.env.LEAD_NOTIFY_EMAIL;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://auramite.io";

const fmtT = (ms: number | null | undefined) => (ms == null ? "?" : (ms / 1000).toFixed(2) + "s");

/** Runs its own scan so the report still arrives if the visitor closed the tab. */
async function scanAndSend(input: string, email: string) {
  const scanner = await import("../../../../lib/scanner.mjs");
  const { buildExplainers } = await import("../../../../lib/explainers.mjs");
  const url = scanner.normalizeUrl(input);
  const host = scanner.hostOf(url);

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const scan = await scanner.scanOne(browser, url, { sendGPC: true, writeReports: false }) as ScanData;

    if (scan.loadError) {
      await resendSend({
        to: email,
        subject: `We couldn't reach ${host}`,
        text: `We tried to scan ${host} but couldn't load it.\n\nDouble-check the address and run it again at ${BASE_URL} — if the site is behind a login or a firewall, reply to this email and we'll scan it another way.\n\n— Auramite`,
      });
      return;
    }

    const explainers = buildExplainers(scan) as Explainer[];
    const hard = scan.hardSaleShare || [];
    const firstShareMs = hard.length ? Math.min(...hard.map((t: { t?: number }) => t.t || 0)) : null;

    const primary = hard[0] || (scan.sessionRecorders || [])[0] || (scan.trackers || [])[0];
    let verifySearch: string | null = null;
    try {
      if (primary?.sample) { const u = new URL(primary.sample); verifySearch = u.hostname.replace(/^www\./, "") + u.pathname; }
    } catch { /* ignore */ }

    const lines: string[] = [];
    lines.push(`Scan results for ${host}`, "", scan.verdict || "", "");

    if (firstShareMs != null) {
      lines.push("Timeline", "--------");
      lines.push(`0.00s   A visitor opens your homepage.`);
      lines.push(`${fmtT(firstShareMs)}   Data already sent to ${hard.map((t: { name: string }) => t.name).join(", ") || "advertisers"}. No one was asked.`);
      if (scan.bannerMs != null) lines.push(`${fmtT(scan.bannerMs)}   Your cookie banner appears — after the data already left.`);
      lines.push("");
    }

    // Same free-tier gate as the site: first finding in full, the rest held back.
    const [first, ...rest] = explainers;
    if (first) {
      lines.push(`Finding 1 of ${explainers.length} — [${first.severity}] ${first.title}`, "-".repeat(60));
      lines.push(first.paragraph, "");
      for (const l of (first.logLines || []) as { text: string }[]) lines.push("  " + l.text);
      if (first.logLines?.length) lines.push("");
      lines.push(`The rule & precedent: ${first.rule}`, "");
    } else {
      lines.push("We didn't find an obvious pre-consent data leak on your homepage.", "");
    }

    if (rest.length) {
      lines.push(
        `${rest.length} more finding${rest.length > 1 ? "s" : ""} (${rest.map((e) => e.severity).join(", ")})`,
        "These are held back on the free scan. Reply to this email and we'll walk you",
        "through all of them on a free 15-minute call — with the proof, and the fix.",
        "",
      );
    }

    if (verifySearch) {
      lines.push(
        "Don't take our word for it",
        "--------------------------",
        `Open ${host} in Chrome, press F12, open the Network tab, hit Ctrl+F and paste:`,
        `  ${verifySearch}`,
        "That request fires before your consent banner.",
        "",
      );
    }

    lines.push("— Auramite", `${BASE_URL}`, "", "Plain-English explanation of measurable findings — not legal advice.");

    await resendSend({
      to: email,
      subject: `Your Auramite scan: ${host} — ${explainers.length} finding${explainers.length === 1 ? "" : "s"}`,
      text: lines.join("\n"),
    });

    if (NOTIFY_TO) {
      await resendSend({
        to: NOTIFY_TO,
        subject: `Emailed report sent — ${host} (${explainers.length} findings)`,
        text: `${email} asked for their results by email.\n\nSite:     ${url}\nFindings: ${explainers.length}\nVerdict:  ${scan.verdict}`,
        replyTo: email,
      });
    }
  } catch (e) {
    console.error("scan-email failed for", input, e);
    await resendSend({
      to: email,
      subject: `We hit a snag scanning ${host}`,
      text: `Something went wrong while scanning ${host}. Reply to this email and we'll run it manually and send you the results.\n\n— Auramite`,
    });
  } finally {
    if (browser) await browser.close();
  }
}

export async function POST(req: Request) {
  // Emailed scans cost a Chromium run AND a Resend send — tighter than /api/scan.
  const rl = rateLimit(`scan-email:${await clientIp()}`, 3, 3600e3);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many requests from your network — try again in a little while." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let body: { email?: string; url?: string; authorized?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  // Same attestation gate as /api/scan — see the note there.
  if (body?.authorized !== true) {
    return NextResponse.json(
      { ok: false, error: "Confirm you own this site or are authorized to scan it." },
      { status: 400 },
    );
  }

  const email = (body?.email || "").toString().trim();
  const url = (body?.url || "").toString().trim();
  if (!isEmail(email)) return NextResponse.json({ ok: false, error: "Enter a valid email." }, { status: 400 });
  if (!url) return NextResponse.json({ ok: false, error: "Missing site URL." }, { status: 400 });

  // Fire and forget: this container is long-lived (Railway), so the scan keeps
  // running after the response. A container restart mid-scan drops the email.
  void scanAndSend(url, email);

  return NextResponse.json({ ok: true });
}
