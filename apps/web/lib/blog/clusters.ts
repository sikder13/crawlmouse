// The /guides topic clusters (moved from app/guides/page.tsx, CC-40 D6). Each post appears once, in
// its primary cluster; when a new post ships, add its slug to the relevant cluster here. The guides
// page draws them, and each post's cluster links (components/blog/ClusterLinks.tsx) read them.
import type { CheckQuestion } from '../v2/copy/check-pages';
import { POSTS, type BlogPostMeta } from './posts';

export interface Cluster {
  /** The cluster's anchor on /guides. */
  id: string;
  title: string;
  blurb: string;
  slugs: readonly string[];
  /** A cluster of fewer than three posts names the cluster its posts' other related links come from. */
  neighbour?: string;
}

export const CLUSTERS: readonly Cluster[] = [
  {
    id: 'internal-linking',
    title: 'Internal linking, start here',
    blurb:
      'What internal linking is, how to audit it, and the orphan pages that quietly waste your work.',
    slugs: ['free-internal-link-audit', 'orphan-pages'],
    neighbour: 'orphan-pages-by-platform',
  },
  {
    id: 'crawl-depth',
    title: 'Crawl depth & site architecture',
    blurb:
      'How far your pages sit from the homepage, why it matters, and how to pull the important ones up.',
    slugs: ['crawl-depth-site-architecture', 'how-deep-is-too-deep-crawl-depth'],
    neighbour: 'internal-linking',
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

/** The most related posts a post lists. */
export const MAX_RELATED = 3;

const isResearch = (p: BlogPostMeta) => (p.tags ?? []).includes('research');
const bySlug = (slug: string) => POSTS.find((p) => p.slug === slug);

/**
 * The posts a post links to as related: the others in its cluster, starting after it and wrapping
 * (so each post in a cluster is listed by another), then the first of its neighbour cluster's, up to
 * `MAX_RELATED`. Never itself and never a research-tagged post. Empty for a post in no cluster.
 */
export function relatedPosts(slug: string): BlogPostMeta[] {
  const cluster = clusterOf(slug);
  if (!cluster) return [];
  const at = cluster.slugs.indexOf(slug);
  const n = cluster.slugs.length;
  const own = cluster.slugs.map((_, i) => cluster.slugs[(at + 1 + i) % n]!);
  const neighbour = CLUSTERS.find((c) => c.id === cluster.neighbour)?.slugs ?? [];
  const out: BlogPostMeta[] = [];
  for (const s of [...own, ...neighbour]) {
    const post = bySlug(s);
    if (!post || post.slug === slug || isResearch(post) || out.includes(post)) continue;
    out.push(post);
    if (out.length === MAX_RELATED) break;
  }
  return out;
}

/** The posts that explain each /check page's question; the page and each post link to each other. */
export const CHECK_EXPLAINERS: Readonly<Record<CheckQuestion, readonly string[]>> = {
  gptbot: ['block-ai-crawlers-robots-txt', 'cloudflare-ai-crawler-defaults-september-15'],
  javascript: ['can-ai-crawlers-see-javascript'],
  'robots-ai': ['block-ai-crawlers-robots-txt'],
};

/** The /check questions a post explains. */
export function checksExplainedBy(slug: string): CheckQuestion[] {
  return (Object.keys(CHECK_EXPLAINERS) as CheckQuestion[]).filter((q) =>
    CHECK_EXPLAINERS[q].includes(slug),
  );
}
