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
import { rules } from './rules.js';
import { ContentCheckSchema, FoundViaSchema, JsTextStateSchema, PageKindSchema } from './enums.js';
import {
  ContentSimhashSchema,
  DeclaredCanonicalSchema,
  HreflangSchema,
  RedirectChainSchema,
  SearchRobotsSchema,
} from './page-facts.js';

export const PageResultSchema = z
  .strictObject({
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
    /** Where the request for `url` ended (`status_code` is that response's); null when nothing answered. */
    final_url: HttpUrlSchema.nullable(),
    /** The redirects behind `final_url`; null when not recorded. */
    redirect: RedirectChainSchema.nullable(),
    /**
     * The canonical the page declares, as written. Null when it was not read: the page was not read,
     * its href was not kept (over the URL cap, or not storable as written), or the page was read only in
     * part and none was found before reading stopped.
     */
    canonical_declared: DeclaredCanonicalSchema.nullable(),
    /** The page's hreflang alternates; null when the page was not read. */
    hreflang: HreflangSchema.nullable(),
    /**
     * Null when the page was not read whole, or its main content is too short to hash (under the
     * engine's SIMHASH_MIN_TOKENS).
     */
    content_simhash: ContentSimhashSchema.nullable(),
    /**
     * The response was HTML (by its Content-Type): a page whose links are read. False for a non-HTML
     * resource (a PDF, an image, a feed served as XML), and when no response came back.
     */
    is_html: z.boolean(),
    /**
     * Every link on the page was read: the whole response was parsed and no link was left unread. False
     * for a page read in part or not at all, so `links_out` 0 is never mistaken for "no links". Only
     * an HTML response can be true.
     */
    links_read: z.boolean(),
    /** robots.txt's verdict on this URL for each search engine (Googlebot, Bingbot). */
    robots_search: SearchRobotsSchema,
  })
  .check(
    rules((p, rule) => {
      if (p.links_read && !p.is_html) rule.fail('links_read_html');
    }),
  );

export type PageResult = z.infer<typeof PageResultSchema>;
