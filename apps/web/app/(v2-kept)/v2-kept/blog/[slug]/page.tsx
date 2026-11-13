import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import BlogPostPage, { generateMetadata as v1Metadata } from '@/app/blog/[slug]/page';
import { keptPage } from '@/app/(v2-kept)/_lib/KeptShell';
import { ArticleLayout } from '@/components/blog/ArticleLayout';
import { checksPublicEnabled } from '@/lib/auth/flags';

export { generateStaticParams } from '@/app/blog/[slug]/page';

type Props = { params: Promise<{ slug: string }> };

/** The post's share image as v1's segment declares it (`app/blog/[slug]/opengraph-image.tsx`). */
const POST_IMAGE = {
  alt: 'A Crawlmouse guide to internal linking and site structure',
  type: 'image/png',
  width: 1200,
  height: 630,
};

/**
 * v1's metadata, with the post's own share image named. On v1 it comes from the segment's
 * `opengraph-image.tsx`, which this segment does not have, so without it a share would show the
 * root's image. Next adds a hash of the image file's source to v1's URL as a query; this URL has
 * none, and serves the same image. `kept-pages.test.tsx` holds the alt, size and type to the file's.
 */
export async function generateMetadata(props: Props): Promise<Metadata> {
  const metadata = await v1Metadata(props);
  // v1's answer for a slug that names no post: no metadata (and the page is a 404).
  if (metadata.openGraph === undefined) return metadata;
  const { slug } = await props.params;
  const images = [{ url: `/blog/${slug}/opengraph-image`, ...POST_IMAGE }];
  return {
    ...metadata,
    openGraph: { ...metadata.openGraph, images },
    twitter: { ...metadata.twitter, images },
  };
}

/** `/blog/<slug>` in the v2 shell while V2_CHECKS_PUBLIC is on (CC-36 D3); a 404 with it off. */
export default async function KeptBlogPostPage(props: Props) {
  if (!checksPublicEnabled()) return notFound();
  return keptPage(await BlogPostPage(props), [ArticleLayout]);
}
