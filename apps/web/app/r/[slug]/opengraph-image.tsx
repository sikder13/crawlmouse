import { ImageResponse } from 'next/og';
import { getPublicReport } from '@/lib/reports';
import { isReportGone } from '@/lib/report-visibility';
import { asNumber } from '@/lib/numeric';
import { isPassingScore } from '@/lib/limits';
import { BRAND } from '@/lib/brand';
import { siteHost } from '@/lib/site-url';
import { whiteLabelBrandName } from '@/lib/report-brand';

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Crawlmouse audit report';
// The card for a given report never changes; cache the render so a viral tweet
// doesn't re-run satori for every unfurl.
export const revalidate = 3600;

// In Next 15 the params of a metadata image route is a Promise and MUST be awaited
// — reading `params.slug` synchronously yields undefined, which silently fell back
// to the bare placeholder for *every* card (the whole viral hook, broken).
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const report = await getPublicReport(slug);

  // A GONE report — missing, taken down, HIDDEN (§9), or ungradeable — unfurls the bare placeholder,
  // NOT its grade+domain. The page 404s and purgePublicReport purges this OG segment on hide/takedown,
  // so the card flips to the placeholder immediately (deploy-order-safe: hidden_at is undefined on a
  // pre-migration read → not gone). Mirrors the page's isReportGone gate exactly.
  if (!report || isReportGone(report)) {
    return new ImageResponse(<div style={{ fontSize: 48 }}>Crawlmouse</div>, size);
  }

  const scoreNum = asNumber(report.score);
  const grade = report.grade ?? '?';
  const score = scoreNum != null ? scoreNum.toFixed(0) : '—';
  const passing = isPassingScore(scoreNum);
  // SPEC 04 §5 — a white-labeled report unfurls the owner's brand as the eyebrow instead of the
  // Crawlmouse wordmark (the URL stays crawlmouse.com — an honest v1 limit). null → Crawlmouse.
  const brand = whiteLabelBrandName(report.white_label);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: BRAND.cream,
          display: 'flex',
          flexDirection: 'column',
          padding: 60,
          fontFamily: 'serif',
        }}
      >
        <div style={{ color: BRAND.inkMuted, fontSize: 22, textTransform: brand ? 'none' : 'uppercase', letterSpacing: 2, marginBottom: 16, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {brand ?? 'crawlmouse audit'}
        </div>
        <div style={{ color: BRAND.ink, fontSize: 36, fontWeight: 600, marginBottom: 40, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {report.domain}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 30 }}>
          <div style={{ fontSize: 280, fontWeight: 800, lineHeight: 1, color: passing ? BRAND.sage : BRAND.peach }}>{grade}</div>
          <div style={{ fontSize: 64, color: BRAND.ink, marginBottom: 30 }}>{score} / 100</div>
        </div>
        <div style={{ marginTop: 'auto', color: BRAND.inkMuted, fontSize: 24 }}>
          {siteHost()}
        </div>
      </div>
    ),
    size,
  );
}
