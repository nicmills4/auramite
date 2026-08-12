"use client";

import { useActionState } from "react";
import { createTestCustomer, addOrgPage, deleteOrg, runTestScan, type AdminState } from "./actions";
import { PLANS } from "@/lib/plans";

const gold = "#e3b341";
const input =
  "rounded-lg border border-white/15 bg-white/[0.05] px-3 py-2 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-[#e3b341] disabled:opacity-50";

function Feedback({ state }: { state: AdminState }) {
  if (state?.error) {
    return <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/[0.08] px-3 py-2 text-sm text-red-300">{state.error}</p>;
  }
  if (state?.ok) {
    return <p className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] px-3 py-2 text-sm text-emerald-200">{state.ok}</p>;
  }
  return null;
}

export function CreateCustomerForm({ defaultEmail }: { defaultEmail: string }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(createTestCustomer, null);
  return (
    <>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-zinc-500">
          Email
          <input name="email" type="email" required defaultValue={defaultEmail} className={`mt-1 block w-64 ${input}`} />
        </label>
        <label className="text-xs text-zinc-500">
          Plan
          <select name="plan" defaultValue="GROWTH" className={`mt-1 block ${input}`}>
            {PLANS.map((p) => <option key={p.plan} value={p.plan}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-zinc-500">
          First page (optional)
          <input name="url" type="text" placeholder="example.com" className={`mt-1 block w-56 ${input}`} />
        </label>
        <button type="submit" disabled={pending}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-[#0b0a08] transition hover:brightness-110 disabled:opacity-50"
          style={{ background: gold }}>
          {pending ? "Creating…" : "Create customer"}
        </button>
      </form>
      <Feedback state={state} />
    </>
  );
}

export function TestScanButton({ orgId, pageCount }: { orgId: string; pageCount: number }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(runTestScan, null);
  return (
    <>
      <form action={action}>
        <input type="hidden" name="orgId" value={orgId} />
        <button type="submit" disabled={pending || pageCount === 0}
          className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white transition hover:bg-white/[0.06] disabled:opacity-40">
          {pending ? "Starting…" : "Run test scan"}
        </button>
      </form>
      <Feedback state={state} />
    </>
  );
}

export function AddPageForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(addOrgPage, null);
  return (
    <>
      <form action={action} className="flex gap-2">
        <input type="hidden" name="orgId" value={orgId} />
        <input name="url" type="text" required placeholder="example.com/checkout" className={`flex-1 ${input}`} />
        <button type="submit" disabled={pending}
          className="shrink-0 rounded-lg border border-white/15 px-3 py-2 text-xs text-white transition hover:bg-white/[0.06] disabled:opacity-50">
          {pending ? "Adding…" : "Add page"}
        </button>
      </form>
      <Feedback state={state} />
    </>
  );
}

export function DeleteOrgForm({ orgId, label }: { orgId: string; label: string }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(deleteOrg, null);
  return (
    <>
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="orgId" value={orgId} />
        <input name="confirm" type="text" placeholder="type DELETE" aria-label={`Type DELETE to remove ${label}`}
          className={`w-32 ${input} border-red-500/25`} />
        <button type="submit" disabled={pending}
          className="rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-300 transition hover:bg-red-500/10 disabled:opacity-50">
          {pending ? "Deleting…" : "Delete org"}
        </button>
      </form>
      <Feedback state={state} />
    </>
  );
}
