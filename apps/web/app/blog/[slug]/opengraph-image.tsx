import { ImageResponse } from 'next/og';
import { POSTS_BY_SLUG, allPostSlugs } from '@/lib/blog/posts';

// Per-post social card so each article shares its own image (its title), not the generic homepage card.
export const alt = 'A Crawlmouse guide to internal linking and site structure';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export function generateStaticParams() {
  return allPostSlugs().map((slug) => ({ slug }));
}

export default async function BlogOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const title = POSTS_BY_SLUG.get(slug)?.title ?? 'The Crawlmouse blog';

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 56,
              height: 56,
              borderRadius: 16,
              background: '#ff7849',
              color: '#fdfaf5',
              fontSize: 34,
              fontWeight: 800,
            }}
          >
            C
          </div>
          <div style={{ display: 'flex', fontSize: 28, fontWeight: 700, color: '#1a1a18', opacity: 0.7 }}>
            The Crawlmouse blog
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: 60, fontWeight: 800, color: '#1a1a18', lineHeight: 1.12, letterSpacing: -1.5 }}>
          {title}
        </div>

        <div style={{ display: 'flex', fontSize: 26, color: '#1a1a18', opacity: 0.6 }}>
          crawlmouse.com · internal linking, graded
        </div>
      </div>
    ),
    { ...size },
  );
}
