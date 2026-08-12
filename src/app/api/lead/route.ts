import { NextResponse } from "next/server";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

// MVP lead capture: appends to data/leads.jsonl. On Railway, swap for Postgres.
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
  try {
    const dir = join(process.cwd(), "data");
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "leads.jsonl"), JSON.stringify({ email, url, intent, at: new Date().toISOString() }) + "\n");
  } catch {
    /* non-fatal for MVP */
  }
  return NextResponse.json({ ok: true });
}
