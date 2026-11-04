/** The content checks over a check's pages: per-page failures, the Quotable input and the template rule. */
import { describe, expect, it } from 'vitest';
import { fingerprintOf } from '../detectors/fingerprint.js';
import { aggregateContent, type ContentPage } from './aggregate.js';
import type { ContentFeatures } from './read.js';

const NO_BYLINE = {
  meta_author: false,
  published_time: false,
  rel_author: false,
  itemprop_author: false,
  itemprop_date: false,
  time_datetime: false,
};
/** A prose page whose opening answers (or not), with no JSON-LD and no section headings. */
function prose(answers: boolean): ContentFeatures {
  return {
    client_rendered: false,
    has_h1: true,
    words_after_h1: 200,
    opening: [{ tag: 'p', words: 200, answer_sentences: answers ? 1 : 0, question: false }],
    headings: { count: 0, questions: 0 },
    json_ld: [],
    byline: NO_BYLINE,
    specs: { structured: 0, label_value_lines: 0, spec_images: 0 },
  };
}
const shell: ContentFeatures = {
  ...prose(false),
  client_rendered: true,
  has_h1: false,
  words_after_h1: 0,
  opening: [],
};

let n = 0;
const pages = (template: string, spec: (ContentFeatures | null)[]): ContentPage[] =>
  spec.map((features) => ({ url: `https://a.test/p${n++}`, template_key: template, features }));
const answerRecord = (ps: ContentPage[]) =>
  aggregateContent(ps).detections.filter((d) => d.type === 'quotable_opening');

describe('the template rule', () => {
  it('detected: 2 or more failing pages, and at least half of those decided', () => {
    const [d] = answerRecord(
      pages('/blog/{slug}', [prose(false), prose(false), prose(true), prose(true)]),
    );
    expect(d).toMatchObject({
      key: 'answer:/blog/{slug}',
      fingerprint: fingerprintOf('answer:/blog/{slug}'),
      state: 'detected',
      reason: null,
      measured: 0.5,
      extent: { failing: 2, of: 4, unread: 0 },
      recommendation_class: 'experimental',
    });
    expect(d!.affected_urls).toHaveLength(2);
  });

  it('not detected at 10 % failing or less; indeterminate between (hysteresis)', () => {
    const ten = [prose(false), ...Array.from({ length: 9 }, () => prose(true))];
    expect(answerRecord(pages('/a', ten))[0]).toMatchObject({
      state: 'not_detected',
      measured: 0.1,
    });
    const third = [prose(false), prose(true), prose(true)];
    expect(answerRecord(pages('/b', third))[0]).toMatchObject({
      state: 'indeterminate',
      reason: 'hysteresis_band',
    });
  });

  it('one failing page of one is too few pages to open a fix', () => {
    expect(answerRecord(pages('/c', [prose(false)]))[0]).toMatchObject({
      state: 'indeterminate',
      reason: 'too_few_pages',
    });
  });

  it('a template with an unread page is indeterminate, whatever its read pages say', () => {
    expect(answerRecord(pages('/d', [prose(false), prose(false), shell]))[0]).toMatchObject({
      state: 'indeterminate',
      reason: 'pages_not_read',
      extent: { failing: 2, of: 2, unread: 1 },
      affected_urls: [],
    });
    expect(answerRecord(pages('/e', [null]))[0]).toMatchObject({
      state: 'indeterminate',
      reason: 'pages_not_read',
      measured: null,
    });
  });

  it('a template the check applies to on no page, with nothing unread, has no record', () => {
    const notProse = {
      ...prose(false),
      words_after_h1: 20,
      opening: [{ tag: 'p', words: 20, answer_sentences: 0, question: false }],
    };
    expect(answerRecord(pages('/f', [notProse, notProse]))).toEqual([]);
  });

  it('question_headings and schema_with_description score Quotable but have no fix type, so no record', () => {
    const types = new Set(
      aggregateContent(pages('/g', [prose(false), prose(false)])).detections.map((d) => d.type),
    );
    expect(types).toEqual(new Set(['quotable_opening']));
  });
});

describe('page failures and the Quotable input', () => {
  it('each page lists the checks it fails; an unread page lists none (null)', () => {
    const ps = pages('/h', [prose(false), prose(true), shell, null]);
    const r = aggregateContent(ps);
    expect(ps.map((p) => r.content_failures.get(p.url))).toEqual([
      ['direct_answer_150'],
      [],
      null,
      null,
    ]);
    expect(r.quotable.unread).toBe(2);
    expect(r.quotable.checks.direct_answer_150).toEqual({ passing: 1, decided: 2 });
    expect(r.quotable.checks.author_and_date).toEqual({ passing: 0, decided: 0 });
  });

  it('the summary lists, per check, the templates it was decided on', () => {
    const r = aggregateContent([
      ...pages('/x', [prose(true), prose(false)]),
      ...pages('/y', [shell]),
    ]);
    expect(r.by_template.find((c) => c.check === 'direct_answer_150')!.by_template).toEqual([
      { template_key: '/x', passing: 1, total: 2 },
    ]);
  });
});
