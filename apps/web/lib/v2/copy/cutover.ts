/**
 * The words of the v1 cutover's answers (CC-36): the page a retired leaderboard answers with, and the
 * JSON a retired v1 API route answers with. Plain strings with no imports, so the middleware that
 * sends them (lib/v2/cutover.ts) pulls in nothing else.
 */

export const LEADERBOARDS_GONE = {
  title: 'Leaderboards were retired',
  heading: 'Leaderboards were retired',
  body: 'Crawlmouse no longer ranks sites against each other. You can still check any site, including the ones that were listed here.',
  home: 'Check a site',
} as const;

/** The `error` of a retired v1 API route's 410: what to call instead, or that nothing replaces it. */
export const API_GONE = {
  replaced: (replacement: string) => `This v1 endpoint was retired. Use ${replacement} instead.`,
  removed: 'This v1 endpoint was retired and nothing replaces it.',
} as const;
