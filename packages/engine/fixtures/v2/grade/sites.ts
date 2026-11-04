/**
 * Example sites for the grade tests and the grade-change guard (expected.json): the client-rendered
 * site every crawler is served, and a blog with crawlers blocked, openings without an answer and pages
 * no link reaches. Built from the access and structure fixtures' builders, so the records are the
 * detectors' own.
 */
import type { PageResult } from '@crawlmouse/types/v2';
import { detectAccess } from '../../../src/v2/access/index.js';
import type { AccessDetection } from '../../../src/v2/access/types.js';
import type { ContentFeatures } from '../../../src/v2/content/read.js';
import { detectStructure } from '../../../src/v2/detectors/index.js';
import type { GradeInput } from '../../../src/v2/grade/index.js';
import { grid } from '../access/builders.js';
import { site, type PageSpec } from '../detectors/builders.js';

/** A blog post served as HTML: passes every content check but the opening, which answers or not. */
export const post = (answers: boolean): ContentFeatures => ({
  client_rendered: false,
  has_h1: true,
  words_after_h1: 300,
  opening: [{ tag: 'p', words: 160, answer_sentences: answers ? 1 : 0, question: false }],
  headings: { count: 4, questions: 1 },
  json_ld: [
    {
      types: ['BlogPosting'],
      has_description: true,
      has_author: true,
      has_dated_publication: true,
    },
  ],
  byline: {
    meta_author: true,
    published_time: true,
    rel_author: false,
    itemprop_author: false,
    itemprop_date: false,
    time_datetime: false,
  },
  specs: { structured: 0, label_value_lines: 0, spec_images: 0 },
});

const REFUSAL = {
  excludedPageCount: 0,
  estimateSource: 'frontier',
  crawlTruncated: false,
} as const;
const CONTENT_SIGNALS =
  '# Content-Signal: search=yes, ai-input=yes, ai-train=yes\nUser-agent: *\nAllow: /';

/**
 * Six pages, all linked to each other, every crawler served; `textShare` of each page's words served
 * without JavaScript, or null before any page is rendered.
 */
export function csrSite(textShare: number | null): GradeInput {
  const paths = ['/', '/p/1', '/p/2', '/p/3', '/p/4', '/p/5'];
  const s = site(paths.map((path) => ({ path, links: paths.filter((p) => p !== path) })));
  const pages: PageResult[] = s.pages.map((p) => ({
    ...p,
    without_js:
      textShare === null
        ? null
        : { raw_words: 310, rendered_words: 1000, text_share: textShare, state: 'partial' },
  }));
  return {
    pages,
    edges: s.edges,
    homepage_url: s.homepage_url,
    content: new Map(pages.map((p) => [p.url, post(true)])),
    crawlers: detectAccess(grid({ pages: ['/', '/p/1'] })).crawlers,
    structure: detectStructure(s),
    robots_txt: CONTENT_SIGNALS,
    title_and_meta: null,
    refusal: REFUSAL,
  };
}

export type Cells = Parameters<typeof grid>[0]['cells'];

/**
 * A homepage and `n` posts linked both ways, every page rendered in full; `unanswered` posts lack an
 * answer-first opening; `cells` are the crawlers' verdicts on two sampled pages; a page under /app/ is
 * served for JavaScript to fill in.
 */
export function blogSite(
  n: number,
  unanswered: number,
  cells: Cells = {},
  extra: PageSpec[] = [],
): { input: GradeInput; access: AccessDetection[] } {
  const posts = Array.from({ length: n }, (_, i) => `/blog/post-${i}`);
  const s = site([
    { path: '/', links: posts },
    ...posts.map((path) => ({ path, template: '/blog/{slug}', links: ['/'] })),
    ...extra,
  ]);
  const content = new Map<string, ContentFeatures>(
    s.pages.map((p, i) => [
      p.url,
      p.template_key === '/app/{slug}'
        ? { ...post(false), client_rendered: true }
        : post(!(p.template_key === '/blog/{slug}' && i <= unanswered)),
    ]),
  );
  const access = detectAccess(grid({ pages: ['/', '/p/1'], cells }));
  const pages: PageResult[] = s.pages.map((p) => ({
    ...p,
    without_js: { raw_words: 300, rendered_words: 300, text_share: 1, state: 'readable' },
  }));
  return {
    input: {
      pages,
      edges: s.edges,
      homepage_url: s.homepage_url,
      content,
      crawlers: access.crawlers,
      structure: detectStructure(s),
      robots_txt: '',
      title_and_meta: null,
      refusal: REFUSAL,
    },
    access: access.detections,
  };
}
