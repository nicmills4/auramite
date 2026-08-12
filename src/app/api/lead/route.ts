import { NextResponse } from "next/server";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

const RESEND_KEY = process.env.RESEND_API_KEY;
const NOTIFY_TO = process.env.LEAD_NOTIFY_EMAIL;           // where YOU get notified
const FROM = process.env.LEAD_FROM_EMAIL || "Auramite <onboarding@resend.dev>"; // verified sender

// Minimal Resend send (no SDK dependency). Best-effort — never throws to the caller.
async function resendSend(opts: { to: string; subject: string; text: string; replyTo?: string }) {
  if (!RESEND_KEY) return;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
  });
  if (!res.ok) console.error("Resend send failed:", res.status, await res.text().catch(() => ""));
}

export async function POST(req: Request) {
  let body: { email?: string; url?: string; intent?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const email = (body?.email || "").toString().trim();
  const url = (body?.url || "").toString().trim();
  const intent = (body?.intent || "monitoring").toString().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: "Enter a valid email." }, { status: 400 });
  }

  // Backup to disk (ephemeral on Railway, but a harmless local record).
  try {
    const dir = join(process.cwd(), "data");
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "leads.jsonl"), JSON.stringify({ email, url, intent, at: new Date().toISOString() }) + "\n");
  } catch { /* non-fatal */ }

  // Notify you (reply-to set to the lead so you can respond directly).
  try {
    if (NOTIFY_TO) {
      await resendSend({
        to: NOTIFY_TO,
        subject: `New ${intent} lead — ${url || "(no site given)"}`,
        text: `Email:  ${email}\nSite:   ${url || "(none)"}\nIntent: ${intent}\nWhen:   ${new Date().toISOString()}`,
        replyTo: email,
      });
    }
  } catch (e) { console.error("notify error", e); }

  // Auto-reply to the lead (only sends once auramite.io is a verified Resend sender).
  try {
    const msg = intent === "consultation"
      ? `Thanks for requesting a consultation${url ? ` for ${url}` : ""}. We'll email you shortly to lock in a free 15-minute walkthrough of everything we found on your site — with the proof — and exactly how to fix it.\n\n— Auramite`
      : `Thanks for reaching out${url ? ` about ${url}` : ""}. We'll follow up shortly about monitoring your site and keeping it clean.\n\n— Auramite`;
    await resendSend({ to: email, subject: "Thanks — we'll be in touch (Auramite)", text: msg });
  } catch (e) { console.error("autoreply error", e); }

  return NextResponse.json({ ok: true });
}
