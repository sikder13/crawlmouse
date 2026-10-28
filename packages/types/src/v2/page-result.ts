/** PageResult: one crawled page in one check. Identified by (check_id, url). */
import { z } from 'zod';
import {
  CountSchema,
  DateSchema,
  HttpStatusSchema,
  HttpUrlSchema,
  IdSchema,
  ShareSchema,
  TemplateKeySchema,
} from './common.js';
import { ContentCheckSchema, FoundViaSchema, JsTextStateSchema, PageKindSchema } from './enums.js';

export const PageResultSchema = z.strictObject({
  check_id: IdSchema,
  url: HttpUrlSchema,
  template_key: TemplateKeySchema,
  /** v1 PageKind: only `content` pages are graded. */
  kind: PageKindSchema,
  status_code: HttpStatusSchema,
  /** Clicks from the homepage; null when no link path reaches it. */
  depth: CountSchema.nullable(),
  links_in: CountSchema,
  links_out: CountSchema,
  pagerank_share: ShareSchema.nullable(),
  is_orphan: z.boolean(),
  /** Reachable only through links that JavaScript creates. */
  js_only: z.boolean(),
  found_via: FoundViaSchema,
  /** `<lastmod>` from the sitemap ("Last changed"). */
  sitemap_lastmod: DateSchema.nullable(),
  /** For an orphan: the page it belongs under. */
  suggested_parent_url: HttpUrlSchema.nullable(),
  /** In the sample tested as each AI crawler. */
  sampled: z.boolean(),
  without_js: z
    .strictObject({
      raw_words: CountSchema,
      rendered_words: CountSchema,
      text_share: ShareSchema,
      state: JsTextStateSchema,
    })
    .nullable(),
  /** Of the AI crawlers tested: how many reach the page, and how many of those read its text. */
  crawlers_reached: CountSchema.nullable(),
  crawlers_reading_text: CountSchema.nullable(),
  /** The quotability checks this page fails; null when the page was not evaluated. */
  content_failures: z.array(ContentCheckSchema).nullable(),
});

export type PageResult = z.infer<typeof PageResultSchema>;
