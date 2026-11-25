/**
 * How long a report's share card may be served from a cache (F-241). The card is a credential of
 * sorts for a takedown: once a report is taken down or hidden, its host and grade must stop being
 * served. `purgePublicReport` clears the by-slug read, so the next render draws the placeholder; what
 * it cannot clear is a copy the CDN already holds, which Vercel keeps for `s-maxage` (or until the
 * next deployment). So that copy is short-lived, and no browser or proxy reuses one without asking
 * again (`max-age=0`).
 *
 * What no header can reach: a social platform's own copy of a card it has already fetched (X,
 * LinkedIn, Slack, Facebook). Those are refreshed only through each platform's own tools.
 */
export const OG_CARD_EDGE_SECONDS = 300;

/** Replaces ImageResponse's default `public, immutable, no-transform, max-age=31536000`. */
export const OG_CARD_HEADERS = {
  'cache-control': `public, max-age=0, s-maxage=${OG_CARD_EDGE_SECONDS}, no-transform`,
} as const;
