/**
 * The five checks on synthetic features: when each applies, passes and fails. The positives here are
 * synthetic; the real-page label set (labels.test.ts) has none for specs_as_text or direct_answer_150.
 */
import { describe, expect, it } from 'vitest';
import { judgePage } from './checks.js';
import type { Block, ContentFeatures, JsonLdNode } from './read.js';

const block = (tag: string, words: number, answer_sentences = 0, question = false): Block => ({
  tag,
  words,
  answer_sentences,
  question,
});
const node = (types: string[], over: Partial<JsonLdNode> = {}): JsonLdNode => ({
  types,
  has_description: false,
  has_author: false,
  has_dated_publication: false,
  ...over,
});
const NO_BYLINE = {
  meta_author: false,
  published_time: false,
  rel_author: false,
  itemprop_author: false,
  itemprop_date: false,
  time_datetime: false,
};
function features(over: Partial<ContentFeatures> = {}): ContentFeatures {
  const opening = over.opening ?? [block('p', 200, 3)];
  return {
    client_rendered: false,
    has_h1: true,
    words_after_h1: opening.reduce((n, b) => n + b.words, 0),
    opening,
    headings: { count: 0, questions: 0 },
    json_ld: [],
    byline: NO_BYLINE,
    specs: { structured: 0, label_value_lines: 0, spec_images: 0 },
    ...over,
  };
}

describe('direct_answer_150', () => {
  const judge = (f: Partial<ContentFeatures>) => judgePage(features(f)).direct_answer_150;

  it('passes on a prose block with an answer-shaped sentence in the first 150 words', () => {
    expect(judge({ opening: [block('p', 5), block('p', 200, 1)] })).toBe('pass');
  });

  it('fails when the first 150 words are lists and furniture: synthetic, a table of contents and a byline', () => {
    expect(
      judge({
        opening: [
          block('p', 4, 1),
          ...Array.from({ length: 30 }, () => block('li', 6, 1)),
          block('p', 100, 1),
        ],
      }),
    ).toBe('fail');
  });

  it('an answer that starts past the first 150 words does not count', () => {
    expect(judge({ opening: [block('p', 160), block('p', 50, 1)] })).toBe('fail');
  });

  it('does not apply without an H1, under 150 words, or on a product page', () => {
    expect(judge({ has_h1: false })).toBe('not_applicable');
    expect(judge({ opening: [block('p', 149, 1)] })).toBe('not_applicable');
    expect(judge({ json_ld: [node(['Product'])] })).toBe('not_applicable');
  });
});

describe('question_headings', () => {
  const judge = (f: Partial<ContentFeatures>) => judgePage(features(f)).question_headings;

  it('passes with a question among three or more section headings, fails with none', () => {
    expect(judge({ headings: { count: 3, questions: 1 } })).toBe('pass');
    expect(judge({ headings: { count: 3, questions: 0 } })).toBe('fail');
  });

  it('does not apply under three section headings, or off a page of prose', () => {
    expect(judge({ headings: { count: 2, questions: 0 } })).toBe('not_applicable');
    expect(judge({ headings: { count: 5, questions: 0 }, json_ld: [node(['Product'])] })).toBe(
      'not_applicable',
    );
    expect(judge({ headings: { count: 5, questions: 0 }, opening: [block('p', 100, 1)] })).toBe(
      'not_applicable',
    );
  });
});

describe('schema_with_description', () => {
  const judge = (json_ld: JsonLdNode[]) => judgePage(features({ json_ld })).schema_with_description;

  it("passes when a node about the page's own subject has a description", () => {
    for (const t of [
      'WebPage',
      'ItemPage',
      'BlogPosting',
      'NewsArticle',
      'Product',
      'Service',
      'TouristTrip',
      'Car',
    ]) {
      expect(judge([node([t], { has_description: true })]), t).toBe('pass');
    }
  });

  it('fails when only site-wide nodes have one: the site, the business, its navigation', () => {
    for (const t of [
      'WebSite',
      'Organization',
      'LocalBusiness',
      'ProfessionalService',
      'FinancialService',
      'SiteNavigationElement',
    ]) {
      expect(judge([node([t], { has_description: true }), node(['WebPage'])]), t).toBe('fail');
    }
  });

  it('does not apply without JSON-LD', () => {
    expect(judge([])).toBe('not_applicable');
  });
});

describe('author_and_date', () => {
  const judge = (f: Partial<ContentFeatures>) => judgePage(features(f)).author_and_date;
  const article = (over: Partial<JsonLdNode> = {}) => [node(['BlogPosting'], over)];

  it('passes with an author and a dated publication, from JSON-LD or the page markup', () => {
    expect(judge({ json_ld: article({ has_author: true, has_dated_publication: true }) })).toBe(
      'pass',
    );
    expect(
      judge({
        json_ld: article(),
        byline: { ...NO_BYLINE, itemprop_author: true, time_datetime: true },
      }),
    ).toBe('pass');
    expect(
      judge({
        json_ld: article(),
        byline: { ...NO_BYLINE, meta_author: true, published_time: true },
      }),
    ).toBe('pass');
    expect(
      judge({
        json_ld: article({ has_dated_publication: true }),
        byline: { ...NO_BYLINE, rel_author: true },
      }),
    ).toBe('pass');
    expect(
      judge({
        json_ld: article({ has_author: true }),
        byline: { ...NO_BYLINE, itemprop_date: true },
      }),
    ).toBe('pass');
  });

  it('fails without the author or without the date', () => {
    expect(judge({ json_ld: article({ has_dated_publication: true }) })).toBe('fail');
    expect(judge({ json_ld: article({ has_author: true }) })).toBe('fail');
  });

  it('applies only to a page whose JSON-LD declares an article (og:type is not enough)', () => {
    expect(judge({ json_ld: [node(['WebPage'])] })).toBe('not_applicable');
  });
});

describe('specs_as_text', () => {
  const judge = (specs: ContentFeatures['specs']) =>
    judgePage(features({ json_ld: [node(['Product'])], specs })).specs_as_text;

  it('fails on a product page whose only specifications are an image: synthetic', () => {
    expect(judge({ structured: 0, label_value_lines: 1, spec_images: 1 })).toBe('fail');
  });

  it('passes when the specifications are also text: a table, a list of terms, or two "Label: value" lines', () => {
    expect(judge({ structured: 1, label_value_lines: 0, spec_images: 1 })).toBe('pass');
    expect(judge({ structured: 0, label_value_lines: 2, spec_images: 1 })).toBe('pass');
    expect(judge({ structured: 0, label_value_lines: 0, spec_images: 0 })).toBe('pass');
  });

  it('does not apply off a product page', () => {
    expect(
      judgePage(features({ specs: { structured: 0, label_value_lines: 0, spec_images: 3 } }))
        .specs_as_text,
    ).toBe('not_applicable');
  });
});

describe('a client-rendered page', () => {
  it('is unread for every check, never a failure of an empty shell', () => {
    const v = judgePage(
      features({ client_rendered: true, json_ld: [node(['Product', 'Article'])] }),
    );
    expect(new Set(Object.values(v))).toEqual(new Set(['unread']));
  });
});
