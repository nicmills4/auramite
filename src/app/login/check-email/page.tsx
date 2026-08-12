import type { Metadata } from "next";

export const metadata: Metadata = { title: "Check your email — Auramite" };

const gold = "#e3b341";

export default function CheckEmailPage() {
  return (
    <main className="flex-1 flex items-center justify-center px-6 py-20">
      <div className="w-full max-w-sm text-center">
        <a href="/" className="mb-8 flex items-center justify-center gap-1.5">
          <span className="text-lg font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>Auramite</span>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: gold }} />
        </a>

        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
          <svg viewBox="0 0 24 24" fill="none" className="mx-auto h-9 w-9" aria-hidden>
            <rect x="2.5" y="5" width="19" height="14" rx="2.5" stroke={gold} strokeWidth="1.6" />
            <path d="M3.5 7l8.5 6 8.5-6" stroke={gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h1 className="mt-4 text-xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>Check your email</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            We sent you a sign-in link. Open it on this device and you&apos;ll be signed straight in.
          </p>
          <p className="mt-4 text-xs text-zinc-600">
            The link expires in 24 hours and works once. If it hasn&apos;t arrived in a minute, check your spam folder.
          </p>
        </div>

        <p className="mt-5 text-center text-xs">
          <a href="/login" className="text-zinc-500 transition hover:text-zinc-300">← Use a different email</a>
        </p>
      </div>
    </main>
  );
}
