/**
 * The crawler a verify command requests as: one that gets a page once the fix has landed, so the
 * command can pass (DESIGN-LOCK §7.3).
 */
import type { CrawlerRegistryEntry } from '@crawlmouse/types/v2';
import { CRAWLER_REGISTRY_V2 } from '../crawler-registry.js';
import type { PacketFacts } from './types.js';

/** The verdicts under which a crawler is served the page. */
const SERVED: ReadonlySet<string> = new Set(['allowed', 'allowed_thin']);

/**
 * The user-agent header a request as `entry` carries: the operator's published string, or the
 * crawler's token where the operator prints none, as the access test itself sent
 * (packages/worker/src/identities.ts).
 */
export const userAgentOf = (entry: CrawlerRegistryEntry): string => entry.ua_string ?? entry.token;

/**
 * The first testable crawler, in registry order, that the site serves today; `fixed` names a crawler
 * the fix itself lets in, which is chosen first. Null when there is none: the caller's command then
 * requests as no crawler and its packet says so.
 */
export function verifyCrawler(
  facts: Pick<PacketFacts, 'crawlers'>,
  fixed: string | null = null,
  registry: readonly CrawlerRegistryEntry[] = CRAWLER_REGISTRY_V2,
): CrawlerRegistryEntry | null {
  const testable = registry.filter((e) => e.testable);
  const own = testable.find((e) => e.token === fixed);
  if (own) return own;
  const served = new Set(facts.crawlers.filter((c) => SERVED.has(c.verdict)).map((c) => c.ua));
  return testable.find((e) => served.has(e.token)) ?? null;
}
