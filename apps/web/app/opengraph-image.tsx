import { ImageResponse } from 'next/og';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { V2_SHARE_CARD } from '@/lib/seo/site-copy';

// Default social card for every page that doesn't define its own. Next auto-wires this into the
// page metadata (og:image + twitter:image), so shares render a branded 1200×630 card.
// CC-40 D2: its words are v2's while V2_CHECKS_PUBLIC is on (the card is built with the site, so the
// flag is read at build); with it off they are v1's, and the image is main's byte for byte
// (lib/seo/flags-off-v1.test.tsx).
const V1_CARD = {
  alt: "Crawlmouse — Grade your site's internal linking",
  headline: "Grade your site's internal linking",
  sub: 'Find orphan pages, weak hubs, and deep pages — in seconds.',
  footer: 'Free · No install · Instantly shareable',
};
const card = () => (checksPublicEnabled() ? V2_SHARE_CARD : V1_CARD);

export const alt = card().alt;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  const { headline, sub, footer } = card();
  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#fdfaf5',
        padding: '72px 80px',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 92,
            height: 92,
            borderRadius: 26,
            background: '#ff7849',
            color: '#fdfaf5',
            fontSize: 58,
            fontWeight: 800,
          }}
        >
          A
        </div>
        <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, color: '#1a1a18' }}>
          Crawlmouse
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div
          style={{
            display: 'flex',
            fontSize: 74,
            fontWeight: 800,
            color: '#1a1a18',
            lineHeight: 1.05,
            letterSpacing: -2,
          }}
        >
          {headline}
        </div>
        <div style={{ display: 'flex', fontSize: 33, color: '#1a1a18', opacity: 0.62 }}>{sub}</div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 27,
          color: '#1a1a18',
          opacity: 0.72,
        }}
      >
        <div style={{ display: 'flex' }}>crawlmouse.com</div>
        <div style={{ display: 'flex' }}>{footer}</div>
      </div>
    </div>,
    { ...size },
  );
}
