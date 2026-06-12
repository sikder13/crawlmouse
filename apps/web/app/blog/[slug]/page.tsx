import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPost } from '@/lib/blog/registry';
import { allPostSlugs, postsNewestFirst } from '@/lib/blog/posts';
import { ArticleLayout } from '@/components/blog/ArticleLayout';
import { JsonLd, articleLd, breadcrumbLd } from '@/lib/seo/jsonld';
import { siteUrl } from '@/lib/site-url';

export function generateStaticParams() {
  return allPostSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  const { meta } = post;
  const url = siteUrl(`/blog/${meta.slug}`);
  return {
    title: { absolute: meta.title },
    description: meta.description,
    keywords: meta.keywords,
    alternates: { canonical: `/blog/${meta.slug}` },
    openGraph: {
      type: 'article',
      title: meta.title,
      description: meta.description,
      url,
      publishedTime: meta.publishedAt,
      modifiedTime: meta.updatedAt,
    },
    twitter: { card: 'summary_large_image', title: meta.title, description: meta.description },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();
  const { meta, Body } = post;
  const related = postsNewestFirst().filter((p) => p.slug !== meta.slug).slice(0, 2);

  return (
    <>
      <JsonLd
        data={[
          articleLd(meta),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Blog', path: '/blog' },
            { name: meta.title, path: `/blog/${meta.slug}` },
          ]),
        ]}
      />
      <ArticleLayout meta={meta} related={related}>
        <Body />
      </ArticleLayout>
    </>
  );
}
