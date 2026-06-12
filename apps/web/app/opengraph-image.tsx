import { ImageResponse } from 'next/og';

// Default social card for every page that doesn't define its own. Next auto-wires this into the
// page metadata (og:image + twitter:image), so shares render a branded 1200×630 card.
export const alt = "Crawlmouse — Grade your site's internal linking";
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
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
          <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, color: '#1a1a18' }}>Crawlmouse</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', fontSize: 74, fontWeight: 800, color: '#1a1a18', lineHeight: 1.05, letterSpacing: -2 }}>
            Grade your site&#39;s internal linking
          </div>
          <div style={{ display: 'flex', fontSize: 33, color: '#1a1a18', opacity: 0.62 }}>
            Find orphan pages, weak hubs, and deep pages — in seconds.
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 27, color: '#1a1a18', opacity: 0.72 }}>
          <div style={{ display: 'flex' }}>crawlmouse.com</div>
          <div style={{ display: 'flex' }}>Free · No install · Instantly shareable</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
