import type { ComponentType } from 'react';
import { POSTS_BY_SLUG, type BlogPostMeta } from './posts';
import { HowDeepIsTooDeepBody } from './content/how-deep-is-too-deep-crawl-depth';
import { FreeInternalLinkAuditBody } from './content/free-internal-link-audit';
import { OrphanPagesBody } from './content/orphan-pages';
import { CrawlDepthBody } from './content/crawl-depth-site-architecture';
import { FindOrphanPagesWordpressBody } from './content/find-orphan-pages-wordpress';
import { ScreamingFrogAlternativeBody } from './content/screaming-frog-alternative';
import { SitebulbAlternativeBody } from './content/sitebulb-alternative';
import { DiscoveredNotIndexedBody } from './content/discovered-currently-not-indexed';
import { FindOrphanPagesShopifyBody } from './content/find-orphan-pages-shopify';
import { CanAiCrawlersSeeJavascriptBody } from './content/can-ai-crawlers-see-javascript';
import { SitebulbVsScreamingFrogBody } from './content/sitebulb-vs-screaming-frog';
import { FindOrphanPagesWebflowBody } from './content/find-orphan-pages-webflow';
import { SitebulbVsJetoctopusVsOncrawlBody } from './content/sitebulb-vs-jetoctopus-vs-oncrawl';
import { ScreamingFrogVsLumarDeepcrawlBody } from './content/screaming-frog-vs-lumar-deepcrawl';
import { FindOrphanPagesSquarespaceBody } from './content/find-orphan-pages-squarespace';
import { BlockAiCrawlersRobotsTxtBody } from './content/block-ai-crawlers-robots-txt';
import { CloudflareAiCrawlerDefaultsBody } from './content/cloudflare-ai-crawler-defaults-september-15';

// Maps a post slug to its body component. Kept separate from posts.ts (metadata only) so the sitemap
// and index can read metadata without pulling in every post's JSX.
const BODIES: Record<string, ComponentType> = {
  'how-deep-is-too-deep-crawl-depth': HowDeepIsTooDeepBody,
  'free-internal-link-audit': FreeInternalLinkAuditBody,
  'orphan-pages': OrphanPagesBody,
  'crawl-depth-site-architecture': CrawlDepthBody,
  'find-orphan-pages-wordpress': FindOrphanPagesWordpressBody,
  'screaming-frog-alternative': ScreamingFrogAlternativeBody,
  'sitebulb-alternative': SitebulbAlternativeBody,
  'discovered-currently-not-indexed': DiscoveredNotIndexedBody,
  'find-orphan-pages-shopify': FindOrphanPagesShopifyBody,
  'can-ai-crawlers-see-javascript': CanAiCrawlersSeeJavascriptBody,
  'sitebulb-vs-screaming-frog': SitebulbVsScreamingFrogBody,
  'find-orphan-pages-webflow': FindOrphanPagesWebflowBody,
  'sitebulb-vs-jetoctopus-vs-oncrawl': SitebulbVsJetoctopusVsOncrawlBody,
  'screaming-frog-vs-lumar-deepcrawl': ScreamingFrogVsLumarDeepcrawlBody,
  'find-orphan-pages-squarespace': FindOrphanPagesSquarespaceBody,
  'block-ai-crawlers-robots-txt': BlockAiCrawlersRobotsTxtBody,
  'cloudflare-ai-crawler-defaults-september-15': CloudflareAiCrawlerDefaultsBody,
};

export function getPost(slug: string): { meta: BlogPostMeta; Body: ComponentType } | null {
  const meta = POSTS_BY_SLUG.get(slug);
  const Body = BODIES[slug];
  if (!meta || !Body) return null;
  return { meta, Body };
}
