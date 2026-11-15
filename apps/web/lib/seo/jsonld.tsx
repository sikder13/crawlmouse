import { siteOrigin, siteUrl } from '@/lib/site-url';
import type { BlogPostMeta } from '@/lib/blog/posts';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { billingV2Enabled } from '@/lib/billing/flags';
import { AGENCY_MONTHLY, AGENCY_YEARLY, PRO_MONTHLY, PRO_YEARLY } from '@/lib/billing/prices';
import { PARENT_ORGANIZATION, V2_HOME_DESCRIPTION } from './site-copy';

// Typed schema.org JSON-LD builders + a tiny renderer. Structured data helps search engines
// understand the site (Organization / SoftwareApplication), the homepage (WebSite), the blog
// (Article + BreadcrumbList), and can earn rich results (FAQ). All URLs are absolute.

const NAME = 'Crawlmouse';
const LEGAL_NAME = 'Nahl Technologies Inc';
const DESCRIPTION =
  "Free, no-install internal-linking grader for any website. Crawlmouse maps a site's internal links " +
  'and grades its structure — orphan pages, hub strength, click depth, and anchor diversity — in seconds.';

/**
 * The Organization node, on every page (root layout). While V2_CHECKS_PUBLIC is on it names the
 * company behind Crawlmouse and that company's city; it lists no `sameAs`, because no profile of
 * Crawlmouse's own is known to exist, and no street address, by decision (CC-40 D2). With the flag
 * off it is v1's node unchanged.
 */
export function organizationLd() {
  if (checksPublicEnabled()) {
    const { name, url, address } = PARENT_ORGANIZATION;
    return {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: NAME,
      url: siteOrigin(),
      logo: siteUrl('/apple-icon'),
      parentOrganization: { '@type': 'Organization', name, url },
      address: {
        '@type': 'PostalAddress',
        addressLocality: address.locality,
        addressRegion: address.region,
        addressCountry: address.country,
      },
    };
  }
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

/** One plan at one price; `interval` is how often a paid plan bills (ISO 8601), null for Free. */
function offer(name: string, price: number, interval: 'P1M' | 'P1Y' | null) {
  return {
    '@type': 'Offer',
    name,
    price: String(price),
    priceCurrency: 'USD',
    url: siteUrl('/pricing'),
    ...(interval && {
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: String(price),
        priceCurrency: 'USD',
        billingDuration: interval,
      },
    }),
  };
}

/**
 * The plans on sale, priced from lib/billing/prices.ts: Free, Pro (sold in both builds) and, while
 * V2_BILLING sells it, Agency, each paid plan monthly and yearly.
 */
export function planOffers() {
  return [
    offer('Free', 0, null),
    offer('Pro, monthly', PRO_MONTHLY, 'P1M'),
    offer('Pro, yearly', PRO_YEARLY, 'P1Y'),
    ...(billingV2Enabled()
      ? [
          offer('Agency, monthly', AGENCY_MONTHLY, 'P1M'),
          offer('Agency, yearly', AGENCY_YEARLY, 'P1Y'),
        ]
      : []),
  ];
}

/**
 * The product, on the home page only. While V2_CHECKS_PUBLIC is on it describes v2 and lists every
 * plan on sale at its real price; with the flag off it is v1's node unchanged (one Offer at 0).
 * Never a rating: the site has none to report.
 */
export function softwareApplicationLd() {
  if (checksPublicEnabled()) {
    return {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: NAME,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: siteOrigin(),
      description: V2_HOME_DESCRIPTION,
      offers: planOffers(),
    };
  }
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
