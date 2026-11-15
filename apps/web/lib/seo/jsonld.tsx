import { siteOrigin, siteUrl } from '@/lib/site-url';
import type { BlogPostMeta } from '@/lib/blog/posts';
import { postAbstract } from '@/lib/blog/answers';
import type { PostDataset } from '@/lib/blog/datasets';

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

/**
 * A single page as a WebPage node. Deliberately minimal: name, description, url and the site it is
 * part of. Nothing here asserts an entity the site claims elsewhere — SoftwareApplication is emitted
 * once, on the homepage, and a second copy on a landing page would be the same product claimed twice.
 */
export function webPageLd(args: { name: string; description: string; path: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: args.name,
    description: args.description,
    url: siteUrl(args.path),
    isPartOf: { '@type': 'WebSite', name: NAME, url: siteOrigin() },
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
  // The post's direct answer (lib/blog/answers.ts), the same words the page shows under its H1.
  const abstract = postAbstract(post.slug);
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
    ...(abstract ? { abstract } : {}),
  };
}

/**
 * The data behind a research post as a Dataset node. Every field comes from the post's own body
 * (lib/blog/datasets.ts says where); nothing is asserted that the post does not state, so there is no
 * `license` or `distribution`.
 */
export function datasetLd(post: BlogPostMeta, data: PostDataset, creator: object) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: data.name,
    description: data.description.text,
    temporalCoverage: `${data.collected.start}/${data.collected.end}`,
    size: data.size.text,
    creator,
    url: siteUrl(`/blog/${post.slug}`),
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

/**
 * JSON for the body of a <script> element. JSON.stringify leaves `<`, `>` and `&` as they are, so a
 * string holding `</script>` or `<!--` would end or change the element; U+2028 and U+2029 are escaped
 * too, for old JavaScript parsers. Each becomes its \uXXXX escape, which JSON.parse reads back as the
 * same character, so the data means the same.
 */
export function scriptSafeJson(data: object | object[]): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Renders one or more JSON-LD objects as a <script type="application/ld+json"> tag. */
export function JsonLd({ data }: { data: object | object[] }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: scriptSafeJson(data) }} />
  );
}
