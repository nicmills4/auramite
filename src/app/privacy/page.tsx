import Link from "next/link";
export const metadata = { title: "Privacy Policy — Auramite" };

export default function Privacy() {
  return (
    <main className="flex-1 text-zinc-300">
      <div className="mx-auto max-w-2xl px-5 py-16">
        <Link href="/" className="text-sm" style={{ color: "#e3b341" }}>← Auramite</Link>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>Privacy Policy</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: {new Date().toISOString().slice(0, 10)}. Template — review with counsel before launch.</p>

        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-zinc-400">
          <p><b className="font-medium text-white">We practice what we sell.</b> This site loads no third-party advertising or analytics trackers, sets no marketing cookies, and honors the Global Privacy Control signal. There is nothing to opt out of because we do not sell or share your data.</p>

          <div>
            <h2 className="text-lg font-semibold text-white">What we collect</h2>
            <p className="mt-2">When you run a free scan, we receive the website URL you enter. If you ask for monitoring, we collect the email address you provide. That&apos;s it.</p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">How we use it</h2>
            <p className="mt-2">To run the scan you requested, send the report and any monitoring updates you opt into, and respond to you. We do not sell, share, or rent your information, and we don&apos;t use ad trackers.</p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Scanning third-party sites</h2>
            <p className="mt-2">Our scanner loads publicly available web pages the same way any browser does, records which trackers fire, and produces a report. We do not log into, alter, or access the private systems of any scanned site.</p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Your choices</h2>
            <p className="mt-2">Email us to access or delete any information we hold about you, or to unsubscribe from updates. We honor opt-out preference signals (including GPC).</p>
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
