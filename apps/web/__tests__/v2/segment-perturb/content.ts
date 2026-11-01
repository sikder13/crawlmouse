import type { Check, FixtureDataset } from '@crawlmouse/types/v2';
import { CHECKS } from '../../../lib/v2/recordings';
import type { PerturbTable } from './types';

const rowOf = (c: Check, check: string, template: string) =>
  c
    .content!.checks.find((x) => x.check === check)!
    .by_template.find((r) => r.template_key === template)!;
const render = (d: FixtureDataset) =>
  d.access_tests.find(
    (t) =>
      t.check_id === CHECKS.badFirstAudit &&
      t.ua === null &&
      t.source_ip_class === 'browser_rendering',
  )!;
const fixTitled = (d: FixtureDataset, start: string) =>
  d.fixes.find((f) => f.title.startsWith(start))!;

export const CONTENT_PERTURB: PerturbTable = {
  'content-score': {
    'checks[].content.score': [
      { change: (c) => (c.content!.score = 61), expect: { content: ['61 / 100'] } },
    ],
  },
  'content-checks': {
    'checks[].content.checks[].by_template': [
      {
        change: (c) => (rowOf(c, 'question_headings', '/collections/{slug}').passing = 3),
        expect: { content: ['3 of 42'] },
      },
      {
        change: (c) => (rowOf(c, 'direct_answer_150', '/products/{slug}').passing = 33),
        expect: { content: ['33 of 158', '54 of 214'] },
      },
    ],
  },
  'content-failing': {
    'page_results[].content_failures': [
      {
        change: (_, d) =>
          (d.page_results.find(
            (p) => p.check_id === CHECKS.badFirstAudit && p.url.endsWith('/products/trail-mug'),
          )!.content_failures = ['direct_answer_150']),
        expect: { content: ['/products/trail-mug'] },
      },
    ],
  },
  'content-evidence': {
    'access_tests[].body_excerpt': [
      {
        change: (_, d) => (render(d).body_excerpt = 'Ridge 2P Tent · $329 · in stock'),
        expect: { content: ['Ridge 2P Tent · $329 · in stock'] },
      },
    ],
  },
  'content-tested': {
    'checks[].tested_at': [
      {
        change: (c) => (c.tested_at = '2026-10-25T02:32:00Z'),
        expect: { content: ['Measured 25 Oct 2026 at 02:32 UTC.'] },
      },
    ],
  },
  'content-fixes': {
    'fixes[].detail': [
      {
        change: (_, d) =>
          (fixTitled(d, 'Add author and date').detail = 'a flag in the blog template'),
        expect: { content: ['a flag in the blog template'] },
      },
    ],
    'fixes[].effect': [
      {
        change: (_, d) => {
          const f = fixTitled(d, 'Add author and date');
          f.effect.ai_readability_pending_on = [];
          f.effect.ai_readability = 0;
        },
        expect: { content: ['The effect on AI readability of two of them is not estimated yet'] },
      },
    ],
  },
};
