/**
 * A site that is an empty shell on most routes: every route but one serves an empty `#root` and no
 * text, and its crawl row reads `content_features.client_rendered` true; one blog post serves its text.
 * The host is a reserved, fictional one. It is the empty-root phase's fixture (render/empty-root.ts):
 * v1's classifier keeps the homepage as content and classes the other shells thin, so without that
 * phase only the homepage and the post would be rendered.
 *
 * Templates, by key: `/` (the homepage), `/about-us`, `/app/{slug}` (three pages), `/blog/{slug}` (the
 * post), `/docs/{slug}` (two pages), `/pricing-plans`. The post links to `/app/user-profile`, so that
 * page has the highest PageRank of its template. The Browser Run replies (`EMPTY_SHELL_REPLIES`) give
 * each shell an empty static side and a rendered side of 40 words, and the post 60 words on both.
 */
import { CrawlPageSchema, type ContentFeaturesRow, type CrawlPage } from '@crawlmouse/types/v2';
import type { ReplyFixture } from '../../../src/v2/render/fakes.js';
import type { BuildInput } from '../../../src/v2/build/types.js';
import { crawlRow, edge, oneBatchBuild } from './rows.js';

export const EMPTY_SHELL_HOST = 'https://empty-shell.test';

export const SHELL_PATHS = [
  '/',
  '/about-us',
  '/app/billing-plans',
  '/app/team-settings',
  '/app/user-profile',
  '/docs/api-reference',
  '/docs/getting-started',
  '/pricing-plans',
] as const;
export const POST_PATH = '/blog/hello-world';

export const emptyShellUrl = (path: string): string =>
  path === '/' ? EMPTY_SHELL_HOST : `${EMPTY_SHELL_HOST}${path}`;

const features = (client_rendered: boolean): ContentFeaturesRow => ({
  client_rendered,
  has_h1: !client_rendered,
  words_after_h1: client_rendered ? 0 : 60,
  opening: [],
  headings: { count: client_rendered ? 0 : 1, questions: 0, section_questions: 0 },
  json_ld: [],
  byline: {
    meta_author: false,
    published_time: false,
    rel_author: false,
    itemprop_author: false,
    itemprop_date: false,
    time_datetime: false,
  },
  specs: { structured: 0, label_value_lines: 0, spec_images: 0 },
});

const SHELL_HTML = '<html><head><title>App</title></head><body><div id="root"></div></body></html>';
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const renderedShell = (path: string) =>
  `<html><body><div id="root"><main><p>${words(40)}</p></main></div><!-- ${path} --></body></html>`;
const POST_HTML = `<html><body><main><p>${words(60)}</p></main></body></html>`;

function shellRow(url: string): CrawlPage {
  return CrawlPageSchema.parse({
    ...crawlRow({ url, outcome: 'fetched', status: 200, links_out: 0 }),
    word_count: 0,
    raw_text: '',
    content_simhash: null,
    content_features: features(true),
    main_text_chars: 0,
  });
}

function postRow(url: string): CrawlPage {
  return CrawlPageSchema.parse({
    ...crawlRow({ url, outcome: 'fetched', status: 200, links_out: 1 }),
    content_features: features(false),
  });
}

/** The site's BuildInput: one crawl batch of every route, no access batch, no render. */
export const emptyShellBuild = (): BuildInput =>
  oneBatchBuild(
    EMPTY_SHELL_HOST,
    [...SHELL_PATHS.map((p) => shellRow(emptyShellUrl(p))), postRow(emptyShellUrl(POST_PATH))],
    [edge(emptyShellUrl(POST_PATH), emptyShellUrl('/app/user-profile'), 'your profile')],
  );

/** What the fake Browser Run client answers for each route. */
export const EMPTY_SHELL_REPLIES: ReplyFixture[] = [
  ...SHELL_PATHS.map((p) => ({
    provenance: 'empty-shell-site',
    url: emptyShellUrl(p),
    static: { html: SHELL_HTML, browser_ms: 800 },
    rendered: { html: renderedShell(p), browser_ms: 1600 },
  })),
  {
    provenance: 'empty-shell-site',
    url: emptyShellUrl(POST_PATH),
    static: { html: POST_HTML, browser_ms: 900 },
    rendered: { html: POST_HTML, browser_ms: 1100 },
  },
];
