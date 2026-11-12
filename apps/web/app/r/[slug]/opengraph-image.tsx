import { ImageResponse } from 'next/og';
import { getPublicReport } from '@/lib/reports';
import { BRAND } from '@/lib/brand';
import { siteHost } from '@/lib/site-url';
import { buildOgReportModel } from '@/lib/og-report-model';
import { reportCardOf, type PublicReportCard } from '@/lib/v2/view/public-report';

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

  // CC-29 D6: a live v2 report, with V2_CHECKS_PUBLIC on, draws the v2 card from its snapshot.
  // Every other row is drawn below as before.
  const card = reportCardOf(report);
  if (card) return new ImageResponse(<V2Card card={card} />, size);

  // Every decision about WHAT this card may show lives in buildOgReportModel, which is pure and
  // unit-tested (lib/og-report-model.test.ts) — the card is a PNG, so that model is the only place the
  // payload can actually be asserted on.
  //
  // A GONE report — missing, taken down, HIDDEN (§9) — or one with no verdict at all unfurls the bare
  // placeholder, NOT its grade+domain. purgePublicReport purges this OG segment on hide/takedown, so
  // the card flips to the placeholder immediately (deploy-order-safe: hidden_at is undefined on a
  // pre-migration read → not gone). Mirrors the page's gate exactly.
  const model = buildOgReportModel(report);
  if (model.kind === 'placeholder') {
    return new ImageResponse(<div style={{ fontSize: 48 }}>Crawlmouse</div>, size);
  }

  const { grade, score, passing, brand } = model;

  return new ImageResponse(
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
      <div
        style={{
          color: BRAND.inkMuted,
          fontSize: 22,
          textTransform: brand ? 'none' : 'uppercase',
          letterSpacing: 2,
          marginBottom: 16,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {brand ?? 'crawlmouse audit'}
      </div>
      <div
        style={{
          color: BRAND.ink,
          fontSize: 36,
          fontWeight: 600,
          marginBottom: 40,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {model.domain}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 30 }}>
        <div
          style={{
            fontSize: 280,
            fontWeight: 800,
            lineHeight: 1,
            color: passing ? BRAND.sage : BRAND.peach,
          }}
        >
          {grade}
        </div>
        <div style={{ fontSize: 64, color: BRAND.ink, marginBottom: 30 }}>{score} / 100</div>
      </div>
      <div style={{ marginTop: 'auto', color: BRAND.inkMuted, fontSize: 24 }}>{siteHost()}</div>
    </div>,
    size,
  );
}

/** The v2 design tokens' light colours (DESIGN-LOCK §2), as plain values: satori reads no CSS. */
const V2 = {
  bg: '#F7F8FA',
  line: '#E2E6EB',
  fg: '#13161B',
  fg2: '#3D4654',
  mut: '#5B6472',
  bad: '#9B2613',
};

function V2Card({ card }: { card: PublicReportCard }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: V2.bg,
        display: 'flex',
        flexDirection: 'column',
        padding: 64,
        fontFamily: 'sans-serif',
        color: V2.fg,
      }}
    >
      <div style={{ display: 'flex', fontSize: 40, fontWeight: 600, letterSpacing: -0.8 }}>
        {card.host}
      </div>
      <div style={{ display: 'flex', gap: 72, marginTop: 40 }}>
        {card.grades.map((g) => (
          <div key={g.label} style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 26, color: V2.mut }}>{g.label}</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, marginTop: 8 }}>
              <div
                style={{
                  display: 'flex',
                  fontSize: g.score === null ? 64 : 140,
                  fontWeight: 600,
                  lineHeight: 1,
                  color: g.tone === 'bad' ? V2.bad : V2.fg,
                }}
              >
                {g.mark}
              </div>
              {g.score === null ? null : (
                <div style={{ display: 'flex', fontSize: 36, color: V2.mut, marginBottom: 14 }}>
                  {g.score}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 'auto',
          paddingTop: 28,
          borderTop: `1px solid ${V2.line}`,
          fontSize: 28,
          lineHeight: 1.35,
          color: V2.fg2,
          overflow: 'hidden',
          maxHeight: 140,
        }}
      >
        {card.headline}
      </div>
    </div>
  );
}
