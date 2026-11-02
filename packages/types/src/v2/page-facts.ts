/**
 * What one request showed about a page beyond its status: where it ended, the redirects on the way,
 * the canonical and hreflang it declared, a hash of its main content, whether all its links were
 * read, and what robots.txt says to the search engines about it. PageResult carries these, and so
 * does the crawl worker's row (packages/worker/src/rows/crawl-page.ts), from these same schemas.
 *
 * A null fact was not read. Nothing here is inferred from another field.
 */
import { z } from 'zod';
import { crawledText, HttpStatusSchema, HttpUrlSchema } from './common.js';
import { VerdictSchema } from './enums.js';
import { rules } from './rules.js';

/**
 * The longest URL the worker stores, in characters (packages/worker/src/rows/bounded.ts). A declared
 * href is kept as written, so it is bounded in bytes too: at most four UTF-8 bytes per character.
 */
const MAX_URL_CHARS = 2048;

/** The answers that redirect, as the worker follows them. */
export const REDIRECT_STATUSES: readonly number[] = [301, 302, 303, 307, 308];

/** The worker follows five redirects; a sixth is recorded and stops the chain. */
export const MAX_REDIRECT_HOPS = 6;

export const RedirectHopSchema = z
  .strictObject({
    from: HttpUrlSchema,
    status: HttpStatusSchema,
    /** The Location, resolved; null when it was not kept (over the URL cap). */
    location: HttpUrlSchema.nullable(),
  })
  .check(
    rules((h, rule) => {
      if (!REDIRECT_STATUSES.includes(h.status)) rule.fail('redirect_status');
    }),
  );

/** The redirects between the requested URL and `final_url`, in order. */
export const RedirectChainSchema = z
  .strictObject({
    hops: z.array(RedirectHopSchema).max(MAX_REDIRECT_HOPS),
    /** A Location named a URL the chain had already requested. */
    loop: z.boolean(),
  })
  .check(
    rules((c, rule) => {
      if (c.loop && (c.hops ?? []).length === 0) rule.fail('redirect_loop');
    }),
  );

/**
 * The page's first `link[rel=canonical]`, whatever host it names, the page itself included.
 * `href` is the attribute as written, null when the page declares none; `url` is it resolved against
 * the page, null when it does not resolve to an http(s) URL.
 */
export const DeclaredCanonicalSchema = z
  .strictObject({
    href: crawledText(MAX_URL_CHARS * 4, 1).nullable(),
    url: HttpUrlSchema.nullable(),
  })
  .check(
    rules((c, rule) => {
      if (c.url !== null && c.href === null) rule.fail('canonical_href');
    }),
  );

/** The most hreflang alternates kept for one page. */
export const MAX_HREFLANG_LINKS = 256;
/** The longest hreflang value kept, in characters; a valid one is at most 11 (`zh-Hant-TW`). */
export const MAX_HREFLANG_CHARS = 64;

/**
 * The page's `link[rel=alternate][hreflang]` annotations, in page order. `complete` is false when an
 * annotation was left out (over MAX_HREFLANG_LINKS, a value or href not kept) or the response's Link
 * header also declares hreflang, which the worker does not read.
 */
export const HreflangSchema = z.strictObject({
  links: z
    .array(
      z.strictObject({
        hreflang: crawledText(MAX_HREFLANG_CHARS * 4, 1),
        href: HttpUrlSchema,
      }),
    )
    .max(MAX_HREFLANG_LINKS),
  complete: z.boolean(),
});

/** A 64-bit simhash of the page's main content, as 16 hex digits (engine `simhashForDedup`). */
export const ContentSimhashSchema = z.string().regex(/^[0-9a-f]{16}$/);

/** The verdicts robots.txt alone can give. */
export const ROBOTS_VERDICTS: readonly string[] = [
  'allowed',
  'disallowed_by_robots',
  'not_measured',
];

/**
 * What robots.txt says about the page to each search engine, by registry token, read from the same
 * file the crawl obeyed. `not_measured` when the file's rules for that engine were not evaluated.
 */
export const SearchRobotsSchema = z
  .array(z.strictObject({ ua: z.string().min(1), verdict: VerdictSchema }))
  .check(
    rules((list, rule) => {
      if (list.some((r) => !ROBOTS_VERDICTS.includes(r.verdict))) rule.fail('robots_verdict');
      if (new Set(list.map((r) => r.ua)).size !== list.length) rule.fail('robots_ua_unique');
    }),
  );

export type RedirectChain = z.infer<typeof RedirectChainSchema>;
export type DeclaredCanonical = z.infer<typeof DeclaredCanonicalSchema>;
export type Hreflang = z.infer<typeof HreflangSchema>;
export type SearchRobots = z.infer<typeof SearchRobotsSchema>;
