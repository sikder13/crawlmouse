import type { Check } from '@crawlmouse/types/v2';
import type { PerturbTable } from './types';

const signal = (c: Check, kind: string) => c.signals.find((s) => s.signal === kind)!;

export const SIGNALS_PERTURB: PerturbTable = {
  'signals-found': {
    'checks[].signals[].state': [
      {
        change: (c) => (signal(c, 'llms_txt').state = 'detected'),
        expect: { signals: ['Three of seven agent signals are present.'] },
      },
    ],
    'checks[].signals[].evidence': [
      {
        change: (c) => (signal(c, 'llms_txt').evidence = '/llms.txt → 410'),
        expect: { signals: ['/llms.txt → 410'] },
      },
    ],
    'checks[].signals[].counts_toward_grade': [
      {
        change: (c) => (signal(c, 'content_signals').counts_toward_grade = false),
        expect: { signals: ['One of them, schema, is worth ten points'] },
      },
    ],
  },
  'signals-weight': {
    'checks[].ai_readability.components.signals.max': [
      {
        change: (c) => (c.ai_readability!.components.signals.max = 12 as 10),
        expect: { signals: ['12 of 100'] },
      },
    ],
  },
  'signals-checked': {
    'checks[].tested_at': [
      {
        change: (c) => (c.tested_at = '2026-10-25T02:31:00Z'),
        expect: { signals: ['Checked 25 Oct 2026 at 02:31 UTC.'] },
      },
    ],
  },
  'signals-competitor': {
    'checks[].competitors[].host': [
      {
        change: (c) => (c.competitors[0]!.host = 'ridgeline.example'),
        expect: { signals: ['How ridgeline.example compares'] },
      },
    ],
    'checks[].competitors[].crawlers_with_access': [
      {
        change: (c) => (c.competitors[0]!.crawlers_with_access = 5),
        expect: { signals: ['5 of 6'] },
      },
    ],
    'checks[].competitors[].crawlers_tested': [
      {
        change: (c) => (c.competitors[0]!.crawlers_tested = 8),
        expect: { signals: ['6 of 8'] },
      },
    ],
    'checks[].competitors[].text_share': [
      {
        change: (c) => (c.competitors[0]!.text_share = 0.2),
        expect: { signals: ['20%', 'ahead on what AI crawlers can read'] },
      },
    ],
    'checks[].competitors[].technical_seo': [
      {
        change: (c) => (c.competitors[0]!.technical_seo = { score: 84, grade: 'B+' }),
        expect: { signals: ['B+ · 84', 'behind on technical SEO'] },
      },
    ],
  },
  'signals-own': {
    'checks[].crawlers[].verdict': [
      {
        change: (c) => (c.crawlers.find((x) => x.ua === 'GPTBot')!.verdict = 'allowed'),
        expect: { signals: ['5 of 6'] },
      },
    ],
    'checks[].without_js.site_text_share': [
      {
        change: (c) => (c.without_js!.site_text_share = 0.42),
        expect: { signals: ['42%'] },
      },
    ],
    'checks[].technical_seo.score': [
      {
        change: (c) => (c.technical_seo!.score = 70),
        expect: { signals: ['B · 70', 'behind on technical SEO'] },
      },
    ],
    'checks[].ai_readability.total': [
      {
        change: (c) => {
          const ai = c.ai_readability!;
          if (ai.withheld) throw new Error('bad-site is graded');
          ai.total = 47;
        },
        expect: { signals: ['D · 47'] },
      },
    ],
  },
};
