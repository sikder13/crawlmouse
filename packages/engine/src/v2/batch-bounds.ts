/**
 * What the crawl worker takes in one batch request (its BatchRequestSchema,
 * packages/worker/src/batch/request.ts, which reads these constants). The worker refuses the whole
 * batch when one URL or template key is past them, so the check builder's planners leave such a page
 * out instead.
 */

/** The longest URL a batch may name, and the longest the worker reads from a link. */
export const MAX_URL_LENGTH = 2048;

/** The longest template key an access batch's page may carry. */
export const MAX_TEMPLATE_KEY_LENGTH = 512;
