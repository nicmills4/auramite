import Link from "next/link";
export const metadata = { title: "Terms of Service — Auramite" };

export default function Terms() {
  return (
    <main className="flex-1 text-zinc-300">
      <div className="mx-auto max-w-2xl px-5 py-16">
        <Link href="/" className="text-sm" style={{ color: "#e3b341" }}>← Auramite</Link>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>Terms of Service</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: {new Date().toISOString().slice(0, 10)}. Template — review with counsel before launch.</p>

        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-zinc-400">
          <div>
            <h2 className="text-lg font-semibold text-white">What Auramite provides</h2>
            <p className="mt-2">Auramite scans publicly available web pages and reports which tracking technologies they load and when. Reports describe <b className="font-medium text-white">measurable technical behavior</b> and reference relevant laws and enforcement actions for context.</p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Not legal advice</h2>
            <p className="mt-2">Auramite is not a law firm and does not provide legal advice. Our reports are an engineering assessment, not a determination of legal liability. Whether any law applies to your business depends on facts (such as revenue and number of consumers) we do not assess. Consult qualified counsel for legal questions.</p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">No guarantee of outcome</h2>
            <p className="mt-2">We provide a technical control and evidence. We do not guarantee that following our suggestions will prevent any fine, lawsuit, or regulatory action. Fixing the issues we find reduces measurable exposure; it is not a certification of compliance.</p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Acceptable use</h2>
            <p className="mt-2">Use the scanner on sites you own or are authorized to assess. Don&apos;t use it to disrupt or overload any site.</p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Contact</h2>
            <p className="mt-2">hello@auramite.io</p>
          </div>
        </div>
      </div>
    </main>
  );
}
