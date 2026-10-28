/**
 * The part of the engine the crawl worker (`@crawlmouse/worker`) uses, published as
 * `@crawlmouse/engine/worker`.
 *
 * The package root re-exports the v1 crawler, which imports crawlee at load time. The worker must not
 * load crawlee: it bundles to a single file for a small image, and crawlee is the module behind the
 * production failure in PROJECT_OVERVIEW.md §11. This entry re-exports modules that do not import it.
 */
export { safeFetch } from '../safe-fetch.js';
export type { SafeFetchOptions, SafeFetchResult, SafeFetchHop } from '../safe-fetch.js';
export type { DnsResolver } from '../ssrf-guard.js';
export { parseRobotsTxt, isAllowedByRobots } from '../robots.js';
export type { ParsedRobots, RobotsRules } from '../robots.js';
export { extractPage } from '../extract.js';
export type { ExtractedLink, ExtractedPage } from '../extract.js';
export { toPersistableText } from '../text-safety.js';
export { CRAWLER_REGISTRY_V2 } from './crawler-registry.js';
