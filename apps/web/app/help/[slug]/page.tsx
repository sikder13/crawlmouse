import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HelpArticleScreen } from '@/components/v2/screens/help/HelpScreens';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { JsonLd, breadcrumbLd } from '@/lib/seo/jsonld';
import { HELP_COPY } from '@/lib/v2/help/copy';
import { HELP_SLUGS, isHelpSlug } from '@/lib/v2/help/questions';
import { HELP_INDEX_PATH, helpArticleView } from '@/lib/v2/help/view';
import { socialCardPath } from '@/lib/v2/social-card';
import { socialMetadata } from '@/lib/v2/social-metadata';
import '@/styles/v2/tokens.css';

type Params = { params: Promise<{ slug: string }> };

/** The twelve articles; any other segment is a 404 without rendering. */
export const dynamicParams = false;

export function generateStaticParams() {
  return HELP_SLUGS.map((slug) => ({ slug }));
}

/**
 * Each article's own title (its question), description, canonical and social metadata; indexable
 * (the root layout's robots apply). No FAQPage markup (owner ruling, 2026-11-11); a BreadcrumbList
 * (CC-40 D3).
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  if (!isHelpSlug(slug)) return {};
  const view = helpArticleView(slug);
  return {
    title: view.title,
    description: view.description,
    alternates: { canonical: view.canonical },
    ...socialMetadata({
      path: view.canonical,
      title: view.title,
      description: view.description,
      image: socialCardPath(`help-${slug}`),
    }),
  };
}

/**
 * A help article (CC-33 D4): a 404 unless V2_CHECKS_PUBLIC is on, as the index. Prerendered, so the
 * flag is read when the site is built.
 */
export default async function HelpArticlePage({ params }: Params) {
  if (!checksPublicEnabled()) return notFound();
  const { slug } = await params;
  if (!isHelpSlug(slug)) return notFound();
  const view = helpArticleView(slug);
  return (
    <>
      <JsonLd
        data={breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: HELP_COPY.title, path: HELP_INDEX_PATH },
          { name: view.title, path: view.canonical },
        ])}
      />
      <HelpArticleScreen data={view} />
    </>
  );
}
