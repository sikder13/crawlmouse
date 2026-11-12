/**
 * A public page's social metadata (CC-29 review r1, SEO N5), for its route's `metadata`. Next replaces
 * a parent's `openGraph` and `twitter` objects whole, so a page that sets either sets every field it
 * needs: its own url, title and description, the site name, the large card, and an image. The image is
 * required and is the page's own: a report's, or a v2 page's card (lib/v2/social-card.tsx), never the
 * root's file card (`app/opengraph-image.tsx`), which is v1's internal-linking card (SEO R2-N6).
 * Pinned per page in `__tests__/v2/social-metadata.test.tsx`.
 */
import type { Metadata } from 'next';

/** The suffix the root layout's title template adds, which social titles do not get on their own. */
const SITE_SUFFIX = ' · Crawlmouse';

export interface SocialPage {
  /** The page's address, as its canonical. */
  path: string;
  /** The page's title before the root layout's template adds the site name. */
  title: string;
  description: string;
  /** Whether `title` is already the whole title (`title.absolute` on the page). */
  absolute?: boolean;
  /** The page's card: its address. */
  image: string;
}

export function socialMetadata(page: SocialPage): Pick<Metadata, 'openGraph' | 'twitter'> {
  const title = page.absolute ? page.title : `${page.title}${SITE_SUFFIX}`;
  return {
    openGraph: {
      type: 'website',
      siteName: 'Crawlmouse',
      locale: 'en_US',
      url: page.path,
      title,
      description: page.description,
      images: [{ url: page.image }],
    },
    twitter: { card: 'summary_large_image', title, description: page.description },
  };
}
