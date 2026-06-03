import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { GradeCard } from '@/components/ui/GradeCard';
import { Badge } from '@/components/ui/Badge';
import { getPublicReport } from '@/lib/reports';
import { asNumber } from '@/lib/numeric';
import { isPassingScore } from '@/lib/limits';

// Public reports are owner-vouched (minting requires verified domain ownership) and
// are the product's SEO/share surface, so they're indexable. Content is immutable
// once minted; cache + revalidate instead of paying a full dynamic render per hit.
export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return {
    title: 'Crawlmouse Report',
    robots: { index: true, follow: true },
    openGraph: { images: [{ url: `/r/${slug}/opengraph-image` }] },
  };
}

export default async function PublicReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // One indexed read behind a tagged cache: the audit's grade/score/cms and the headline
  // graph stats are denormalized onto public_reports at mint (populate_public_report
  // trigger), so there's no report->audit->findings fan-out per page view. The
  // `public-report:<slug>` cache tag lets a processed takedown purge this render at once.
  const report = await getPublicReport(slug);

  if (!report || report.takedown_requested_at || !report.grade) notFound();

  const score = asNumber(report.score) ?? 0;

  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 pt-12 pb-32">
        <div className="mb-6">
          <Badge tone="oat">Public report</Badge>
          <h1 className="font-mono text-xl break-all mt-2">{report.domain}</h1>
          <div className="text-xs text-ink/50 mt-1">Audited {new Date(report.created_at).toLocaleDateString()} &middot; {report.cms_detected ?? 'custom'}</div>
        </div>
        <GradeCard
          grade={report.grade}
          score={score}
          orphanCount={report.orphan_count ?? 0}
          avgDepth={asNumber(report.avg_depth) ?? 0}
          passing={isPassingScore(score)}
        />
        <Card className="mt-6 text-center">
          <p className="font-display text-xl">Want one for your site?</p>
          <a href="/" className="inline-block mt-3 bg-peach text-white px-6 py-3 rounded-lg font-medium">Run Crawlmouse on your site &rarr;</a>
        </Card>
        <p className="text-center text-xs text-ink/50 mt-10">Powered by <a href="/" className="text-peach underline">Crawlmouse</a></p>
      </main>
      <Footer />
    </>
  );
}
