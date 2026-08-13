import Link from "next/link";
export const metadata = { title: "Terms of Service — Auramite" };

// Pinned, not computed. A "last updated" date generated at render time claims
// the document changed today whenever someone loads it, which is false and is
// exactly the kind of small inaccuracy a legal page cannot afford. Bump this by
// hand when the terms actually change.
const LAST_UPDATED = "2026-08-13";

const S = ({ h, children }: { h: string; children: React.ReactNode }) => (
  <div>
    <h2 className="text-lg font-semibold text-white">{h}</h2>
    <div className="mt-2 space-y-3">{children}</div>
  </div>
);

export default function Terms() {
  return (
    <main className="flex-1 text-zinc-300">
      <div className="mx-auto max-w-2xl px-5 py-16">
        <Link href="/" className="text-sm" style={{ color: "#e3b341" }}>← Auramite</Link>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>Terms of Service</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: {LAST_UPDATED}. Review with counsel before relying on these terms.</p>

        <div className="mt-8 space-y-7 text-[15px] leading-relaxed text-zinc-400">
          <S h="What Auramite does, precisely">
            <p>
              Auramite loads a web page in an automated browser, exactly as an ordinary visitor&apos;s browser would,
              and records which network requests that page makes, when each one occurred, and which cookies were
              set — before any consent choice is made. It reports those observations, and cites publicly reported
              laws and enforcement actions as context for why they may matter.
            </p>
            <p>
              That is the entire service. Auramite does not access, attempt to access, or test any non-public part
              of any system. It does not bypass authentication, probe for vulnerabilities, or send any traffic a
              normal visit would not send.
            </p>
          </S>

          <S h="Observations, not legal conclusions">
            <p>
              Auramite is not a law firm, is not your attorney, and does not provide legal advice. Nothing in a scan,
              a report, an email, or on this site is a legal opinion, and no attorney–client relationship is created
              by using the service.
            </p>
            <p>
              Our reports state what we measured. Whether any statute applies to a particular business depends on
              facts we do not assess — revenue, consumer counts, sector, the terms of your vendor contracts, your
              actual data practices — and whether any measured behavior amounts to a violation is a legal judgment
              only qualified counsel can make. Treat every finding as a prompt to investigate, not a verdict.
            </p>
          </S>

          <S h="What automated scanning cannot see">
            <p>
              A scan is a single automated page load from one location at one moment. It can miss things and it can
              be wrong. Controls placed behind a consent tool&apos;s preferences dialog, links published as PDFs or on
              another domain, content rendered only after interaction, region-specific behavior, and pages served
              differently to automated browsers are all outside what one page load can observe.
            </p>
            <p>
              Where we cannot confirm something, we say so rather than reporting it as absent. Findings labelled as
              unconfirmed are exactly that, and should be checked by hand before you act on them or repeat them.
            </p>
          </S>

          <S h="No guarantee of outcome">
            <p>
              Auramite provides a technical measurement and the evidence behind it. We do not certify compliance
              with any law, standard, or framework, and we do not guarantee that acting on our findings will prevent
              any fine, claim, lawsuit, investigation, or regulatory action. Reducing measurable pre-consent data
              sharing reduces measurable exposure; it is not a defense and it is not a certification.
            </p>
          </S>

          <S h="Authorized use only">
            <p>
              You may submit a site to the scanner only if you own it or are authorized by its owner to have it
              assessed. You are asked to confirm this before each scan, and that confirmation is a term of this
              agreement, not a formality. You are responsible for having the authority you claim.
            </p>
            <p>
              Do not use the scanner to disrupt, overload, or degrade any site, to evade a site&apos;s access controls,
              or in any manner that violates applicable law. We rate-limit the public scanner and may block, suspend,
              or remove access at our discretion.
            </p>
          </S>

          <S h="Using our reports">
            <p>
              A report we produce about your site is yours to use inside your organization and with the advisors and
              vendors working on it. Reports describe a specific page at a specific time; do not present one as a
              current or general statement about a site, and do not represent our findings as a compliance
              certification or as legal advice from us.
            </p>
          </S>

          <S h="Subscriptions and billing">
            <p>
              Paid plans bill monthly in advance through Stripe and renew until cancelled. You can cancel at any time
              from the billing portal; cancellation takes effect at the end of the current period and access
              continues until then. Prices and plan limits are those shown at the time of purchase.
            </p>
          </S>

          <S h="Limitation of liability">
            <p>
              To the fullest extent permitted by law, Auramite is provided &ldquo;as is&rdquo;, without warranties of
              any kind, express or implied, including any warranty of merchantability, fitness for a particular
              purpose, accuracy, or non-infringement. We are not liable for indirect, incidental, special,
              consequential, exemplary, or punitive damages, nor for lost profits, revenue, data, or goodwill.
            </p>
            <p>
              Our total aggregate liability arising out of or relating to the service is limited to the amount you
              paid us in the twelve months preceding the event giving rise to the claim. Some jurisdictions do not
              allow certain exclusions, so parts of this section may not apply to you.
            </p>
          </S>

          <S h="Your responsibility for how you use findings">
            <p>
              You are responsible for what you do with a report, including any statement you make to third parties
              based on it. You agree to indemnify Auramite against claims arising from your use of the service
              outside these terms — in particular, scanning a site you were not authorized to scan.
            </p>
          </S>

          <S h="Corrections">
            <p>
              If you believe a finding about your site is inaccurate, tell us and we will re-scan and correct or
              withdraw it. We would rather be told than be wrong.
            </p>
          </S>

          <S h="Changes and contact">
            <p>
              We may update these terms; the date above reflects the current version, and continued use after a
              change constitutes acceptance. Questions, corrections and disputes: <span className="text-zinc-200">hello@auramite.io</span>.
            </p>
          </S>
        </div>
      </div>
    </main>
  );
}
