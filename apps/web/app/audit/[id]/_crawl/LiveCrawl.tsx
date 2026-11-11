'use client';

/**
 * The crawl screen of a real check: it follows `GET /api/checks/[id]/stream` and draws what the
 * stream says. Workstream C writes the body; the props are the seam the page renders against.
 */
export interface LiveCrawlProps {
  checkId: string;
  /** The site's host, as the check's site row holds it. */
  host: string;
}

export function LiveCrawl(_props: LiveCrawlProps) {
  return null;
}
