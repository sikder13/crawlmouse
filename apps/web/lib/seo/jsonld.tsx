import { siteOrigin, siteUrl } from '@/lib/site-url';
import type { BlogPostMeta } from '@/lib/blog/posts';

// Typed schema.org JSON-LD builders + a tiny renderer. Structured data helps search engines
// understand the site (Organization / SoftwareApplication), the homepage (WebSite), the blog
// (Article + BreadcrumbList), and can earn rich results (FAQ). All URLs are absolute.

const NAME = 'Crawlmouse';
const LEGAL_NAME = 'Nahl Technologies Inc';
const DESCRIPTION =
  "Free, no-install internal-linking grader for any website. Crawlmouse maps a site's internal links " +
  'and grades its structure — orphan pages, hub strength, click depth, and anchor diversity — in seconds.';

export function organizationLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: NAME,
    legalName: LEGAL_NAME,
    url: siteOrigin(),
    logo: siteUrl('/apple-icon'),
  };
}

export function websiteLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: NAME,
    url: siteOrigin(),
    publisher: { '@type': 'Organization', name: NAME },
  };
}

export function softwareApplicationLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: NAME,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: siteOrigin(),
    description: DESCRIPTION,
    // A genuine free tier (Pro is a paid upgrade); never assert ratings we don't have.
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
}

export function faqLd(items: ReadonlyArray<{ question: string; answer: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((i) => ({
      '@type': 'Question',
      name: i.question,
      acceptedAnswer: { '@type': 'Answer', text: i.answer },
    })),
  };
}

export function articleLd(post: BlogPostMeta) {
  const url = siteUrl(`/blog/${post.slug}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    author: { '@type': 'Organization', name: NAME },
    publisher: {
      '@type': 'Organization',
      name: NAME,
      logo: { '@type': 'ImageObject', url: siteUrl('/apple-icon') },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    image: siteUrl(`/blog/${post.slug}/opengraph-image`),
    keywords: post.keywords.join(', '),
  };
}

export function breadcrumbLd(items: ReadonlyArray<{ name: string; path: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: siteUrl(it.path),
    })),
  };
}

/** Renders one or more JSON-LD objects as a <script type="application/ld+json"> tag. */
export function JsonLd({ data }: { data: object | object[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}
