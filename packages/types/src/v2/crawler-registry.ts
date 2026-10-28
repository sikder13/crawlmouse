/**
 * CrawlerRegistryEntry: a crawler we track, as its operator documents it. The seed data lives in
 * packages/engine/src/v2/crawler-registry.ts.
 *
 * `verification_method` is a list because Google and Bing document both an IP list and reverse DNS.
 * `ua_string` is null when the operator's page prints none (Anthropic, as of 2026-10-27): the engine
 * must not invent one. `as_of` is null when the source page could not be fetched. `none_published`
 * describes none of the eight crawlers as of 2026-10-27: Anthropic, the last without one, now publishes
 * an IP list.
 */
import { z } from 'zod';
import { DateSchema, HttpUrlSchema } from './common.js';
import { CrawlerGroupSchema, VerificationMethodSchema } from './enums.js';
import { rules } from './rules.js';

export const CrawlerRegistryEntrySchema = z
  .strictObject({
    token: z.string().min(1),
    group: CrawlerGroupSchema,
    scored: z.boolean(),
    operator: z.string().min(1),
    purpose: z.string().min(1),
    robots_token: z.string().min(1),
    ua_string: z.string().min(1).nullable(),
    verification_method: z.array(VerificationMethodSchema).min(1),
    ip_list_url: HttpUrlSchema.nullable(),
    /** We can request pages as this crawler and learn something; false for verified search bots. */
    testable: z.boolean(),
    /** Only the site's own logs show what the real crawler got, because sites can tell it from us. */
    needs_owner_logs: z.boolean(),
    source_url: HttpUrlSchema,
    /** Anything the source page leaves unstated or states with a caveat. */
    source_notes: z.array(z.string().min(1)),
    as_of: DateSchema.nullable(),
  })
  .check(
    rules((e, rule) => {
      const methods = e.verification_method;
      if (methods.includes('none_published') && methods.length > 1) rule.fail('verification_alone');
      if (new Set(methods).size !== methods.length) rule.fail('verification_unique');
      rule.exactlyWhen('ip_list_url', methods.includes('ip_list'), e.ip_list_url !== null);
    }),
  );

export type CrawlerRegistryEntry = z.infer<typeof CrawlerRegistryEntrySchema>;
