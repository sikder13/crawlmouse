import type { Check, FixtureDataset } from '@crawlmouse/types/v2';
import { CHECKS } from '../../../lib/v2/recordings';
import type { PerturbTable } from './types';

const page = (d: FixtureDataset, path: string) =>
  d.page_results.find((p) => p.check_id === CHECKS.badFirstAudit && p.url.endsWith(path))!;
const render = (d: FixtureDataset) =>
  d.access_tests.find(
    (t) =>
      t.check_id === CHECKS.badFirstAudit &&
      t.ua === null &&
      t.source_ip_class === 'browser_rendering',
  )!;
const crawler = (c: Check, ua: string) => c.crawlers.find((x) => x.ua === ua)!;
const fix2 = (d: FixtureDataset) =>
  d.fixes.find((f) => f.title === 'Server-render the product template')!;

export const NOJS_PERTURB: PerturbTable = {
  'nojs-site-share': {
    'checks[].without_js.site_text_share': [
      {
        change: (c) => (c.without_js!.site_text_share = 0.42),
        expect: { nojs: ['42% site-wide'] },
      },
    ],
  },
  'nojs-rows': {
    'page_results[].without_js.raw_words': [
      {
        change: (_, d) => (page(d, '/blog/winter-camping').without_js!.raw_words = 1888),
        expect: { nojs: ['1,888'] },
      },
    ],
    'page_results[].without_js.rendered_words': [
      {
        change: (_, d) => (page(d, '/blog/winter-camping').without_js!.rendered_words = 2077),
        expect: { nojs: ['2,077'] },
      },
    ],
    'page_results[].without_js.text_share': [
      {
        change: (_, d) => (page(d, '/blog/winter-camping').without_js!.text_share = 0.81),
        expect: { nojs: ['81%'] },
      },
    ],
    'page_results[].without_js.state': [
      {
        change: (_, d) => (page(d, '/blog/winter-camping').without_js!.state = 'partial'),
        expect: { nojs: ['partial'] },
      },
    ],
    'page_results[].sampled': [
      {
        change: (_, d) => (page(d, '/blog/winter-camping').sampled = false),
        expect: { nojs: ['4 of the 50 measured pages'] },
      },
    ],
  },
  'nojs-measured': {
    'checks[].coverage.pages_sampled': [
      {
        change: (c) => (c.coverage!.pages_sampled = 48),
        expect: { nojs: ['48 of 214', '48 pages (at most 50)'] },
      },
    ],
    'checks[].coverage.pages_discovered': [
      {
        change: (c) => (c.coverage!.pages_discovered = 230),
        expect: { nojs: ['50 of 230', 'All 230 pages'] },
      },
    ],
    'checks[].coverage.sample_strategy.max_pages': [
      {
        change: (c) => (c.coverage!.sample_strategy.max_pages = 60),
        expect: { nojs: ['(at most 60)'] },
      },
    ],
  },
  'nojs-template': {
    'checks[].coverage.templates[].pages': [
      {
        change: (c) => {
          c.coverage!.templates.find((t) => t.label === 'Products')!.pages = 160;
          c.coverage!.pages_crawled = 216;
          c.coverage!.pages_discovered = 216;
        },
        expect: { nojs: ['All 160 product pages share the template', 'Products · 160'] },
      },
    ],
  },
  'nojs-readers': {
    'checks[].crawlers[].verdict': [
      {
        change: (c) => (crawler(c, 'GPTBot').verdict = 'allowed'),
        expect: { nojs: ['Claude-SearchBot, GPTBot and ClaudeBot read the HTML'] },
      },
    ],
  },
  'nojs-evidence': {
    'access_tests[].body_excerpt': [
      {
        change: (_, d) => (render(d).body_excerpt = 'Ridge 2P Tent · $329 · in stock'),
        expect: { nojs: ['Ridge 2P Tent · $329 · in stock'] },
      },
    ],
    'access_tests[].word_count': [
      { change: (_, d) => (render(d).word_count = 1150), expect: { nojs: ['1,150 words.'] } },
    ],
    'access_tests[].tested_at': [
      {
        change: (_, d) => (render(d).tested_at = '2026-10-25T02:33:52Z'),
        expect: { nojs: ['02:33:52 UTC'] },
      },
    ],
  },
  'nojs-tested': {
    'checks[].tested_at': [
      {
        change: (c) => (c.tested_at = '2026-10-25T02:32:00Z'),
        expect: { nojs: ['Measured 25 Oct 2026 at 02:32 UTC.'] },
      },
    ],
  },
  'nojs-fix': {
    'fixes[].title': [
      {
        change: (_, d) => (fix2(d).title = 'Render the product template on the server'),
        expect: { nojs: ['Render the product template on the server'] },
      },
    ],
    'fixes[].effect': [
      {
        change: (_, d) => (fix2(d).effect.ai_readability = 23),
        expect: { nojs: ['+23 AI readability, estimated'] },
      },
    ],
  },
};
