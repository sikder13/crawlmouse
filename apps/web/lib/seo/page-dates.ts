/**
 * The "Last updated" date each legal page shows, for the sitemap's lastModified (CC-40 D3). The pages
 * write the date in their own text; `__tests__/sitemap-last-modified.test.ts` renders each page and
 * fails when its date and this one differ.
 */
export const LEGAL_UPDATED: Readonly<Record<string, string>> = {
  '/privacy': '2026-06-07',
  '/terms': '2026-06-07',
  '/aup': '2026-06-07',
  '/subprocessors': '2026-06-07',
};
