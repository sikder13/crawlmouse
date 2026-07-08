import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { GradeCard } from '@/components/ui/GradeCard';
import { Badge } from '@/components/ui/Badge';
import { getPublicReport } from '@/lib/reports';
import { asNumber } from '@/lib/numeric';
import { isPassingScore } from '@/lib/limits';
import { reportRobotsIndex, isReportGone, isReportClaimed } from '@/lib/report-visibility';
import { ReportBody } from '@/components/report/ReportBody';
import { PrintButton } from '@/components/report/PrintButton';

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

        {r.report_snapshot ? (
          // The full client-ready, section-slot report (frozen SPEC 05 seam). white_label (claimed Pro
          // reports only; null otherwise) swaps the Crawlmouse letterhead for the owner's brand (§5).
          <ReportBody snapshot={r.report_snapshot} claimed={claimed} whiteLabel={r.white_label} />
        ) : (
          // Legacy fallback — a report minted before SPEC 04 (no snapshot) or read pre-migration.
          // Renders from the denormalized columns and never dereferences a (possibly null) audit_id.
          <>
            <div className="text-xs text-ink/50 mt-1 mb-4">
              Audited {new Date(r.created_at).toLocaleDateString()} &middot; {r.cms_detected ?? 'custom'}
            </div>
            <GradeCard
              grade={r.grade!}
              score={asNumber(r.score) ?? 0}
              orphanCount={r.orphan_count ?? 0}
              avgDepth={asNumber(r.avg_depth) ?? 0}
              passing={isPassingScore(asNumber(r.score) ?? 0)}
            />
            <Card className="mt-6 text-center">
              <p className="font-display text-lg">Re-audit for the full report</p>
              <p className="text-sm text-ink/60 mt-1">This report predates our detailed breakdown — run a fresh audit for the executive summary, findings, and prioritised fixes.</p>
              <a href="/" className="inline-block mt-3 bg-peach text-white px-6 py-3 rounded-lg font-medium">Run a fresh audit &rarr;</a>
            </Card>
            <footer className="report-footer mt-10 border-t border-oat pt-6 text-xs text-ink/55 space-y-2">
              <p>
                Automated, deterministic analysis of publicly served HTML, as of {r.created_at.slice(0, 10)}.
                Results are a point-in-time snapshot — <a href="/" className="underline">run a fresh audit</a>.{' '}
                <a href="/bot" className="underline">Methodology</a>.
              </p>
              <p><a href="/takedown" className="underline">Dispute or request removal</a>.</p>
            </footer>
          </>
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
