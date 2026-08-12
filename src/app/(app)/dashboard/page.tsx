import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { card, eyebrow, gold } from "../ui";

export const metadata: Metadata = { title: "Dashboard — Auramite" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-12">
      <p className={eyebrow} style={{ color: gold }}>Dashboard</p>
      <div className={`${card} p-6`}>
        <p className="text-sm text-zinc-400">Results tracking lands here next.</p>
      </div>
    </div>
  );
}
