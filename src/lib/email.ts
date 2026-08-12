// Minimal Resend client (no SDK dependency), shared by the API routes.

const RESEND_KEY = process.env.RESEND_API_KEY;
export const LEAD_FROM = process.env.LEAD_FROM_EMAIL || "Auramite <onboarding@resend.dev>";

export const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

/** Best-effort send — logs and resolves false rather than throwing at the caller. */
export async function resendSend(opts: { to: string; subject: string; text: string; replyTo?: string }): Promise<boolean> {
  if (!RESEND_KEY) {
    console.warn("RESEND_API_KEY not set — skipping email to", opts.to);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: LEAD_FROM,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      console.error("Resend send failed:", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.error("Resend send threw:", e);
    return false;
  }
}
