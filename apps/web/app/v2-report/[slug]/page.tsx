import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import V1ReportPage, { generateMetadata as v1Metadata } from '../../r/[slug]/page';
import { LivePublicReport } from '@/components/v2/screens/public-report/LivePublicReport';
import { ReportViewBeacon } from '@/components/v2/screens/public-report/ReportViewBeacon';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { getPublicReport } from '@/lib/reports';
import { publicReportTitle, reportPageOf } from '@/lib/v2/view/public-report';

/**
 * The shared report while V2_CHECKS_PUBLIC is on (CC-29 D1, D6): `/r/<slug>` is rewritten here
 * (`V2_REWRITES`, lib/v2/rewrites.ts), and the middleware answers a request for this path itself as
 * not found. A row holding a v2 snapshot renders the v2 report from that snapshot alone; every other
 * row, a missing one included, is v1's page, rendered by v1's own module with the same params.
 * With the flag off it is a 404 (the rewrite is not applied then, and `/r/<slug>` is v1's files).
 *
 * Cached as v1's page is, so it reads no request header; a view of either kind is counted by a
 * beacon from the page (`ReportViewBeacon`). `purgePublicReport` revalidates this path beside `/r/<slug>`.
 */
export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = reportPageOf(await getPublicReport(slug));
  if (page.kind !== 'v2') return v1Metadata({ params });
  return {
    title: { absolute: publicReportTitle(page.view.host) },
    robots: { index: page.index, follow: true },
    alternates: { canonical: `/r/${slug}` },
    openGraph: { images: [{ url: `/r/${slug}/opengraph-image` }] },
  };
}

export default async function V2ReportPage({ params }: Props) {
  if (!checksPublicEnabled()) return notFound();
  const { slug } = await params;
  const page = reportPageOf(await getPublicReport(slug));
  // v1's page answers 404 itself for a row that is gone; the beacon renders only beside a report.
  if (page.kind === 'v1')
    return (
      <>
        <ReportViewBeacon slug={slug} />
        {await V1ReportPage({ params })}
      </>
    );
  if (page.kind === 'gone') notFound();
  return <LivePublicReport slug={slug} view={page.view} />;
}
