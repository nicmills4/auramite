"use client";

import { useState } from "react";

const gold = "#e3b341";

async function go(endpoint: string, body?: unknown): Promise<string> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.url) throw new Error(data?.error || "Something went wrong.");
  return data.url as string;
}

export function CheckoutButton({ plan, hot }: { plan: string; hot: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function start() {
    setBusy(true); setErr("");
    try {
      window.location.href = await go("/api/billing/checkout", { plan });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={start}
        disabled={busy}
        className={`mt-6 w-full rounded-lg py-2.5 text-sm font-semibold transition hover:brightness-110 disabled:opacity-60 ${hot ? "text-[#0b0a08]" : "border border-white/15 text-white hover:bg-white/[0.06]"}`}
        style={hot ? { background: gold } : undefined}
      >
        {busy ? "Opening checkout…" : `Choose ${plan}`}
      </button>
      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
    </>
  );
}

export function PortalButton() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function open() {
    setBusy(true); setErr("");
    try {
      window.location.href = await go("/api/billing/portal");
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={open}
        disabled={busy}
        className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/[0.06] disabled:opacity-60"
      >
        {busy ? "Opening…" : "Manage billing"}
      </button>
      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
    </>
  );
}
