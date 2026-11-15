import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LiveHome } from '@/components/v2/screens/home/LiveHome';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { JsonLd, softwareApplicationLd, websiteLd } from '@/lib/seo/jsonld';
import { V2_HOME_DESCRIPTION, V2_HOME_TITLE, V2_SHARE_CARD } from '@/lib/seo/site-copy';

/**
 * v2's title and description for `/` (CC-40 D2). Its own, so the root layout's v1 text, which v1's
 * home and v1 /pricing and /developers inherit, stays main's byte for byte. Next replaces a parent's
 * `openGraph` and `twitter` objects whole and attaches the root's file card only to the root
 * segment's own metadata, so the image is named here: the root share card, whose words follow the same
 * flag (app/opengraph-image.tsx). `app/v2-home/page.test.tsx` pins it. Robots come from the root.
 */
const SHARE_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  type: 'image/png',
  alt: V2_SHARE_CARD.alt,
};

export const metadata: Metadata = {
  title: { absolute: V2_HOME_TITLE },
  description: V2_HOME_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Crawlmouse',
    locale: 'en_US',
    url: '/',
    title: V2_HOME_TITLE,
    description: V2_HOME_DESCRIPTION,
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: V2_HOME_TITLE,
    description: V2_HOME_DESCRIPTION,
    images: [SHARE_IMAGE],
  },
};

/**
 * The v2 home (CC-22b D10), which `/` is rewritten to while V2_CHECKS_PUBLIC is on
 * (`V2_REWRITES`, lib/v2/rewrites.ts, applied by middleware.ts). The middleware answers a request
 * for this path, in any spelling it can read, as not found, so the page has one address, `/`.
 *
 * The structured data is WebSite and SoftwareApplication; v1's FAQPage
 * block is not emitted, because this page shows no FAQ. The v2 stylesheets come with `LiveHome`,
 * which imports the tokens.
 *
 * The page is prerendered, so the flag is read when the site is built: built with the flag off it
 * is a 404, and turning the flag on takes a new deployment (as CRAWL_PAUSED does).
 */
export default function V2HomePage() {
  if (!checksPublicEnabled()) return notFound();
  return (
    <>
      <JsonLd data={[websiteLd(), softwareApplicationLd()]} />
      <LiveHome />
    </>
  );
}
