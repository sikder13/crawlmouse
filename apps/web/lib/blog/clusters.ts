// The /guides topic clusters (moved from app/guides/page.tsx, CC-40 D6). Each post appears once, in
// its primary cluster; when a new post ships, add its slug to the relevant cluster here. The guides
// page draws them, and each post's cluster links (components/blog/ClusterLinks.tsx) read them.

export interface Cluster {
  /** The cluster's anchor on /guides. */
  id: string;
  title: string;
  blurb: string;
  slugs: readonly string[];
}

export const CLUSTERS: readonly Cluster[] = [
  {
    id: 'internal-linking',
    title: 'Internal linking, start here',
    blurb:
      'What internal linking is, how to audit it, and the orphan pages that quietly waste your work.',
    slugs: ['free-internal-link-audit', 'orphan-pages'],
  },
  {
    id: 'crawl-depth',
    title: 'Crawl depth & site architecture',
    blurb:
      'How far your pages sit from the homepage, why it matters, and how to pull the important ones up.',
    slugs: ['crawl-depth-site-architecture', 'how-deep-is-too-deep-crawl-depth'],
  },
  {
    id: 'orphan-pages-by-platform',
    title: 'Orphan pages by platform',
    blurb:
      'The platform-specific traps that strand pages — and how to find every orphan on WordPress, Shopify, Webflow, and Squarespace.',
    slugs: [
      'find-orphan-pages-wordpress',
      'find-orphan-pages-shopify',
      'find-orphan-pages-webflow',
      'find-orphan-pages-squarespace',
    ],
  },
  {
    id: 'tool-alternatives',
    title: 'Free tool alternatives',
    blurb:
      'When a paid desktop crawler is more than you need for an internal-linking read — and what to use instead.',
    slugs: [
      'screaming-frog-alternative',
      'sitebulb-alternative',
      'sitebulb-vs-screaming-frog',
      'sitebulb-vs-jetoctopus-vs-oncrawl',
      'screaming-frog-vs-lumar-deepcrawl',
    ],
  },
  {
    id: 'indexing',
    title: 'Indexing & getting found',
    blurb:
      'Why Google skips your pages, and the internal-linking fixes that get them crawled and indexed.',
    slugs: [
      'discovered-currently-not-indexed',
      'can-ai-crawlers-see-javascript',
      'block-ai-crawlers-robots-txt',
      'cloudflare-ai-crawler-defaults-september-15',
    ],
  },
];

/** A cluster's place on /guides. */
export const clusterHub = (cluster: Cluster) => `/guides#${cluster.id}`;

/** The cluster a post belongs to, or null. */
export function clusterOf(slug: string): Cluster | null {
  return CLUSTERS.find((c) => c.slugs.includes(slug)) ?? null;
}
