import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin";

export const metadata: Metadata = {
  title: "Admin — Auramite",
  // Nothing here should ever be indexed, even accidentally.
  robots: { index: false, follow: false },
};

const gold = "#e3b341";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Gate the whole surface. Each action re-checks independently, because a
  // server action is a POST endpoint that can be called without this layout.
  const { email } = await requireAdmin();

  return (
    <main className="flex-1 text-zinc-300">
      <nav className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#0b0a08]/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="text-lg font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>
              Auramite
            </a>
            <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-red-300">
              Admin
            </span>
          </div>
          <div className="flex items-center gap-5 text-[13px] text-zinc-500">
            <a href="/dashboard" className="transition hover:text-zinc-200">Dashboard</a>
            <a href="/settings" className="transition hover:text-zinc-200">Settings</a>
            <span className="hidden sm:inline" style={{ color: gold }}>{email}</span>
          </div>
        </div>
      </nav>
      {children}
    </main>
  );
}
