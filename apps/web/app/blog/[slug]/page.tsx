import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPost } from '@/lib/blog/registry';
import { allPostSlugs, postsNewestFirst } from '@/lib/blog/posts';
import { ArticleLayout } from '@/components/blog/ArticleLayout';
import { JsonLd, articleLd, breadcrumbLd, datasetLd } from '@/lib/seo/jsonld';
import { siteUrl } from '@/lib/site-url';
import { getAuthor, personLd } from '@/lib/blog/authors';
import type { BlogPostMeta } from '@/lib/blog/posts';
import { getDataset } from '@/lib/blog/datasets';

/** The Article node, with a named author as a Person in place of the Organization. */
function articleNode(meta: BlogPostMeta) {
  const author = meta.author ? getAuthor(meta.author) : null;
  return author ? { ...articleLd(meta), author: personLd(author) } : articleLd(meta);
}

/** A research post's Dataset node, created by the post's author, or none. */
function datasetNodes(meta: BlogPostMeta) {
  const data = getDataset(meta.slug);
  return data ? [datasetLd(meta, data, articleNode(meta).author)] : [];
}

export function generateStaticParams() {
  return allPostSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  const { meta } = post;
  const url = siteUrl(`/blog/${meta.slug}`);
  // The search-result title; the H1 and the Article headline keep `meta.title`.
  const title = meta.seoTitle ?? meta.title;
  return {
    title: { absolute: title },
    description: meta.description,
    keywords: meta.keywords,
    alternates: { canonical: `/blog/${meta.slug}` },
    openGraph: {
      type: 'article',
      title,
      description: meta.description,
      url,
      publishedTime: meta.publishedAt,
      modifiedTime: meta.updatedAt,
    },
    twitter: { card: 'summary_large_image', title, description: meta.description },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();
  const { meta, Body } = post;
  // "Keep reading": the two newest posts, never a research-tagged one, so research posts do not
  // displace the links existing posts already carry (blog-existing-posts-links-unchanged.test.tsx).
  // One line on purpose: __tests__/crawled-text-cut-guard.test.ts inventories this exact line.
  // prettier-ignore
  const related = postsNewestFirst().filter((p) => p.slug !== meta.slug && !(p.tags ?? []).includes('research')).slice(0, 2);

  return (
    <>
      <JsonLd
        data={[
          articleNode(meta),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Blog', path: '/blog' },
            { name: meta.title, path: `/blog/${meta.slug}` },
          ]),
          ...datasetNodes(meta),
        ]}
      />
      <ArticleLayout meta={meta} related={related}>
        <Body />
      </ArticleLayout>
    </>
  );
}
