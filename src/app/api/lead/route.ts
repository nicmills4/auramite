import { NextResponse } from "next/server";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resendSend, isEmail } from "../../../lib/email";

export const runtime = "nodejs";

const NOTIFY_TO = process.env.LEAD_NOTIFY_EMAIL;           // where YOU get notified

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
  if (!isEmail(email)) {
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
