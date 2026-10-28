import { z } from 'zod';
import { HttpUrlSchema, IdSchema, TemplateKeySchema } from '@crawlmouse/types/v2';

/**
 * The body of POST /batch. Strict: an unknown field is refused, so a caller cannot believe it set an
 * option the worker does not have. The three budgets are required; there are no defaults.
 */

export const MAX_URLS_PER_BATCH = 50;
export const BUDGET_CEILINGS = {
  max_requests: 5000,
  max_bytes: 256 * 1024 * 1024,
  max_seconds: 1800,
} as const;

const BudgetSchema = z.strictObject({
  max_requests: z.int().min(1).max(BUDGET_CEILINGS.max_requests),
  max_bytes: z.int().min(1).max(BUDGET_CEILINGS.max_bytes),
  max_seconds: z.int().min(1).max(BUDGET_CEILINGS.max_seconds),
});

const UrlSchema = HttpUrlSchema.max(2048);
const common = {
  check_id: IdSchema,
  site_id: IdSchema,
  batch: z.int().min(0).max(1_000_000),
  /** Single use: a nonce the worker has seen is refused. */
  nonce: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  jwt: z.string().min(1).max(4096),
  budget: BudgetSchema,
};

export const BatchRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('crawl'),
    ...common,
    urls: z.array(UrlSchema).min(1).max(MAX_URLS_PER_BATCH),
  }),
  z.strictObject({
    kind: z.literal('access'),
    ...common,
    pages: z
      .array(z.strictObject({ url: UrlSchema, template_key: TemplateKeySchema.max(512) }))
      .min(1)
      .max(MAX_URLS_PER_BATCH),
  }),
]);

export type BatchRequest = z.infer<typeof BatchRequestSchema>;

export const batchIdOf = (r: Pick<BatchRequest, 'check_id' | 'batch'>): string =>
  `${r.check_id}:${r.batch}`;

export const urlsOf = (r: BatchRequest): string[] =>
  r.kind === 'crawl' ? r.urls : r.pages.map((p) => p.url);
