import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { getPublicReport } from '@/lib/reports';
import { reportRobotsIndex, isReportGone, isReportClaimed } from '@/lib/report-visibility';
import { ReportBody } from '@/components/report/ReportBody';
import { ReportLegacyFallback } from '@/components/report/ReportLegacyFallback';
import { PrintButton } from '@/components/report/PrintButton';
import { ReferralCapture } from '@/components/analytics/ReferralCapture';
import { ReportOwnerIsland } from '@/components/report/owner/ReportOwnerIsland';

// Content is immutable once minted; cache + revalidate instead of paying a full dynamic render per
// hit. Indexability is decided PER REPORT in generateMetadata (SPEC 04 §8: unclaimed → noindex), not
// as a blanket route default.
export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const report = await getPublicReport(slug);
  // A gone report (hidden/taken-down/missing) renders 404 in the page; keep it noindex here too.
  const index = report && !isReportGone(report) ? reportRobotsIndex(report) : false;
  return {
    title: 'Crawlmouse Report',
    robots: { index, follow: true },
    // §6/§8/§13 — the shared links carry `?ref=` for K attribution; a self-referencing canonical keeps
    // those query variants from entering the index as duplicates and splitting the report's link equity.
    alternates: { canonical: `/r/${slug}` },
    openGraph: { images: [{ url: `/r/${slug}/opengraph-image` }] },
  };
}

export default async function PublicReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const report = await getPublicReport(slug);

  // Hidden, taken-down, missing, or ungradeable → 404. (hidden_at undefined on a pre-migration read is
  // falsy → not hidden, so existing reports keep rendering before Runbook B is applied.)
  if (isReportGone(report)) notFound();
  const r = report!;
  const claimed = isReportClaimed(r);

  return (
    <>
      {/* §13 — a shared /r/<slug>?ref link lands here; capture the referral source for K measurement. */}
      <ReferralCapture />
      <div className="no-print">
        <Header />
      </div>
      <main className="report-print max-w-3xl mx-auto px-6 pt-12 pb-32">
        <div className="mb-2 flex items-start justify-between gap-4">
          <div>
            <Badge tone="oat">Public report</Badge>
            <h1 className="font-mono text-xl break-all mt-2">{r.domain}</h1>
          </div>
          <div className="no-print pt-1">
            <PrintButton />
          </div>
        </div>

        {/* §2–§4 owner controls — a CLIENT ISLAND (never server-rendered from session, so the ISR page
            stays revalidate=300 and the cached HTML is owner-agnostic, U10). `claimed` is a public fact. */}
        <div className="no-print mb-6">
          <ReportOwnerIsland slug={slug} domain={r.domain} reportClaimed={claimed} />
        </div>

        {r.report_snapshot ? (
          // The full client-ready, section-slot report (frozen SPEC 05 seam). white_label (claimed Pro
          // reports only; null otherwise) swaps the Crawlmouse letterhead for the owner's brand (§5).
          <ReportBody snapshot={r.report_snapshot} claimed={claimed} whiteLabel={r.white_label} />
        ) : (
          // Legacy fallback — a report minted before SPEC 04 (no snapshot) or read pre-migration. Renders
          // from the denormalized columns; the owner's white-label brand (§5 / FIX 1) renders here too, so a
          // claimed/branded legacy report no longer shows the Crawlmouse wordmark. Inside `.report-print`, so
          // the brand carries onto the printed PDF.
          <ReportLegacyFallback report={r} />
        )}

        <Card className="no-print mt-8 text-center">
          <p className="font-display text-xl">Want one for your site?</p>
          <a href="/" className="inline-block mt-3 bg-peach text-white px-6 py-3 rounded-lg font-medium">Run Crawlmouse on your site &rarr;</a>
        </Card>
      </main>
      <div className="no-print">
        <Footer />
      </div>
    </>
  );
}
