/**
 * The part of the engine the crawl worker (`@crawlmouse/worker`) uses, published as
 * `@crawlmouse/engine/worker`.
 *
 * The package root re-exports the v1 crawler, which imports crawlee at load time. The worker must not
 * load crawlee: it bundles to a single file for a small image, and crawlee is the module behind the
 * production failure in PROJECT_OVERVIEW.md §11. This entry re-exports modules that do not import it.
 */
export { safeFetch } from '../safe-fetch.js';
export type { SafeFetchOptions, SafeFetchResult } from '../safe-fetch.js';
export type { DnsResolver } from '../ssrf-guard.js';
export {
  parseRobotsTxt,
  isAllowedByRobots,
  getCrawlDelay,
  ROBOTS_PARSE_LIMIT_BYTES,
} from '../robots.js';
export type { ParsedRobots, RobotsRules } from '../robots.js';
export { extractPage, sameHostIgnoringWww } from '../extract.js';
export type { ExtractedLink, ExtractedPage } from '../extract.js';
export { toPersistableText } from '../text-safety.js';
export { canonicalizeUrl } from '../url-canonical.js';
export { MainContentWalk } from '../analysis/ai-readiness/main-content-walk.js';
export {
  ImpliedBody,
  FRAMESET_OK_OFF,
  HEAD_EMPTY,
  HEAD_HOLDING,
  HEAD_WRAPPERS,
  HTML_WHITESPACE,
  RAW_TEXT,
} from '../analysis/ai-readiness/main-content-implied-body.js';
export { simhashForDedup, SIMHASH_MAX_TOKENS, SIMHASH_MIN_TOKENS } from '../analysis/simhash.js';
export { CRAWLER_REGISTRY_V2 } from './crawler-registry.js';
