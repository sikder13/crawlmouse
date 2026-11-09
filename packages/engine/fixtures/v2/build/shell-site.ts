/**
 * A site that serves one app shell on every route, shaped like www.alynthe.com as the CC-12b staging
 * smoke met it (CC-20 follow-up §2 item 1): nine routes, the same 3,598-byte body on each, no link,
 * every link read, `content_features.client_rendered` true. The host is a reserved, fictional one.
 *
 * The row values are what the worker's own reader (packages/worker/src/reader/read.ts `readPage`)
 * gives, measured on 2026-11-08:
 *   - `SHELL`: the 3,598-byte body www.alynthe.com served at / and /about (identical bytes): 0 words,
 *     0 links, main text 0 characters, no content hash, `client_rendered` true, and the features below.
 *   - `SHELL_WITH_TEXT`: the same kind of shell with one line of text of its own beside the empty
 *     root, `<p>` of 14 words: main text 110 characters, still no content hash (under the 100 tokens
 *     a hash needs), `client_rendered` true, 0 links. v1's classifier keeps such a page as content.
 */
import {
  CrawlPageSchema,
  type ContentFeaturesRow,
  type CrawlPage,
  type Site,
} from '@crawlmouse/types/v2';
import type { BuildInput } from '../../../src/v2/build/types.js';
import { recordedInput } from './recorded.js';
import { CHECK, SITE, crawlBatch, crawlRow } from './rows.js';

export const SHELL_HOST = 'https://shell-site.test';

export const SHELL_ROUTES = [
  '/',
  '/about',
  '/services',
  '/contact',
  '/portfolio',
  '/blog',
  '/work/brand-site',
  '/work/shop-rebuild',
  '/work/chat-assistant',
] as const;

export const shellUrl = (path: string): string =>
  path === '/' ? SHELL_HOST : `${SHELL_HOST}${path}`;

/** What `readPage` read of the measured shell, less the one field each case sets. */
const FEATURES: Omit<ContentFeaturesRow, 'client_rendered'> = {
  has_h1: false,
  words_after_h1: 0,
  opening: [],
  headings: { count: 0, questions: 0, section_questions: 0 },
  json_ld: [
    {
      types: ['ProfessionalService'],
      has_description: false,
      has_author: false,
      has_dated_publication: false,
    },
  ],
  byline: {
    meta_author: true,
    published_time: false,
    rel_author: false,
    itemprop_author: false,
    itemprop_date: false,
    time_datetime: false,
  },
  specs: { structured: 0, label_value_lines: 0, spec_images: 0 },
};

export interface ShellOptions {
  /** `content_features.client_rendered` on every row. */
  clientRendered: boolean;
  /** `SHELL` (no text of its own) or `SHELL_WITH_TEXT` (one line of text, kept as content). */
  shell: 'SHELL' | 'SHELL_WITH_TEXT';
}

function shellRow(url: string, o: ShellOptions): CrawlPage {
  const text = o.shell === 'SHELL_WITH_TEXT';
  return CrawlPageSchema.parse({
    ...crawlRow({ url, outcome: 'fetched', status: 200, links_out: 0 }),
    byte_count: 3598,
    word_count: text ? 14 : 0,
    raw_text: text
      ? 'Alynthe builds websites, local search and automation for businesses across central Indiana, from Indianapolis.'
      : '',
    links_out: 0,
    links_read: true,
    content_simhash: null,
    content_features: { ...FEATURES, client_rendered: o.clientRendered },
    main_text_chars: text ? 110 : 0,
    noindex: false,
  });
}

/** The shell site's BuildInput: one crawl batch of every route, no access batch, no render. */
export function shellBuild(o: ShellOptions): BuildInput {
  const base = recordedInput();
  const site: Site = { ...base.site, id: SITE, host: new URL(SHELL_HOST).host };
  return {
    ...base,
    check: { ...base.check, id: CHECK, site_id: SITE },
    site,
    homepage_url: SHELL_HOST,
    seeds: [
      { url: `${SHELL_HOST}/`, source: 'homepage', lastmod: null },
      ...SHELL_ROUTES.filter((p) => p !== '/').map((p) => ({
        url: shellUrl(p),
        source: 'sitemap' as const,
        lastmod: null,
      })),
    ],
    batches: [
      crawlBatch(
        0,
        SHELL_ROUTES.map((p) => shellRow(shellUrl(p), o)),
      ),
    ],
    render: null,
  };
}
