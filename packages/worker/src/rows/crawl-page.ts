import { CAPS } from './bounded.js';

/**
 * CrawlPage, the row a crawl batch returns for each URL, is a contract type: its schema is in
 * `packages/types/src/v2/worker-batch.ts`, so a consumer can parse it without this package. The worker
 * builds each row with CrawlPageSchema.parse (batch/crawl.ts `pageRow`).
 */
export { CrawlPageSchema, type CrawlPage } from '@crawlmouse/types/v2';

export const RAW_TEXT_BYTES = CAPS.rawText.bytes;
