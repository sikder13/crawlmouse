import { AI_BOT_REGISTRY } from '@crawlmouse/engine';

/**
 * The AI crawler tokens the engine already tracks, read from the engine rather than re-listed here.
 * A second copy of this list is a list that disagrees the first time a token is added, and the
 * study's whole claim is that it measures the same bots the product measures.
 */
export const AI_TOKENS: readonly string[] = AI_BOT_REGISTRY.map((b) => b.token);

/**
 * The multi-purpose crawlers, added for the question Cloudflare's September 15 change raises: a
 * zone that blocks Training can take a search crawler with it, because these crawl for both.
 */
export const SEARCH_TOKENS: readonly string[] = ['Googlebot', 'Bingbot', 'Applebot'];

export const ALL_TOKENS: readonly string[] = [...AI_TOKENS, ...SEARCH_TOKENS];

export const BOT_CLASS: ReadonlyMap<string, string> = new Map([
  ...AI_BOT_REGISTRY.map((b) => [b.token, b.botClass] as const),
  ...SEARCH_TOKENS.map((t) => [t, 'search'] as const),
]);
