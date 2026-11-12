import type { PacketEntry } from '../types.js';

/** A robots.txt disallow is the site's stated intent: it opens no fix (grade/outcomes.ts), so none is written. */
export const robotsTxtBlocksCrawler: PacketEntry<'robots_txt_blocks_crawler'> = {
  kind: 'none',
  reason:
    'robots.txt disallows the crawler, which is the site’s stated intent: the engine opens no fix for it.',
};
