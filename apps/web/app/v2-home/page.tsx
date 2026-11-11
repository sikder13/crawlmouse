import { notFound } from 'next/navigation';
import { LiveHome } from '@/components/v2/screens/home/LiveHome';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { JsonLd, softwareApplicationLd, websiteLd } from '@/lib/seo/jsonld';

/**
 * The v2 home (CC-22b D10), which `/` is rewritten to while V2_CHECKS_PUBLIC is on
 * (`V2_REWRITES`, middleware.ts). The middleware answers a request for this path itself as not
 * found, so the page has one address, `/`.
 *
 * It exports no metadata: the root layout's title, description, canonical (`/`) and robots apply,
 * as they do to v1's home. The structured data is WebSite and SoftwareApplication; v1's FAQPage
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
