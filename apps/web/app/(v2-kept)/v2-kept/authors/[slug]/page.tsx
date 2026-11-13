import { notFound } from 'next/navigation';
import AuthorPage from '@/app/authors/[slug]/page';
import { keptPage } from '@/app/(v2-kept)/_lib/KeptShell';
import { checksPublicEnabled } from '@/lib/auth/flags';

export { generateMetadata, generateStaticParams } from '@/app/authors/[slug]/page';

// v1's page's (a route-segment export must be a literal in the page itself).
export const dynamicParams = false;

/**
 * `/authors/<slug>` in the v2 shell while V2_CHECKS_PUBLIC is on (CC-36 D3, `V2_REWRITES`); a 404
 * with it off. v1's page answers 404 itself for an author with no post.
 */
export default async function KeptAuthorPage(props: { params: Promise<{ slug: string }> }) {
  if (!checksPublicEnabled()) return notFound();
  return keptPage(await AuthorPage(props));
}
