import type { Check, FixtureDataset } from '@crawlmouse/types/v2';
import { CHECKS } from '../../../lib/v2/recordings';
import type { PerturbTable } from './types';

const crawler = (c: Check, ua: string) => c.crawlers.find((x) => x.ua === ua)!;
/** The response the page opens on: GPTBot on the homepage, in the bad site's first audit. */
const opened = (d: FixtureDataset) =>
  d.access_tests.find(
    (t) => t.check_id === CHECKS.badFirstAudit && t.ua === 'GPTBot' && t.template_key === '/',
  )!;
const fix1 = (d: FixtureDataset) => d.fixes.find((f) => f.title.startsWith('Let GPTBot'))!;

export const ACCESS_PERTURB: PerturbTable = {
  'access-verdicts': {
    'checks[].crawlers[].verdict': [
      {
        change: (c) => (crawler(c, 'PerplexityBot').verdict = 'blocked_by_ua_rule'),
        expect: { access: ['2 blocked'] },
      },
    ],
    'checks[].crawlers[].by_template': [
      {
        change: (c) => (crawler(c, 'ClaudeBot').by_template[0]!.verdict = 'rate_limited'),
        expect: { access: ['rate limited'] },
      },
    ],
    'checks[].crawlers[].evidence_class': [
      {
        change: (c) => (crawler(c, 'Bingbot').evidence_class = 'simulated'),
        expect: { access: ['Bingbot allowed simulated'] },
      },
    ],
  },
  'access-text': {
    'checks[].crawlers[].text_share': [
      { change: (c) => (crawler(c, 'ClaudeBot').text_share = 0.44), expect: { access: ['44%'] } },
    ],
  },
  'access-cause': {
    'checks[].crawlers[].cause': [
      {
        change: (c) => (crawler(c, 'GPTBot').cause = 'pay_per_crawl_402'),
        expect: { access: ['pay per crawl (402)'] },
      },
    ],
  },
  'access-columns': {
    'checks[].coverage.templates[].pages': [
      {
        change: (c) => {
          c.coverage!.templates.find((t) => t.label === 'Products')!.pages = 160;
          c.coverage!.pages_crawled = 216;
          c.coverage!.pages_discovered = 216;
        },
        expect: { access: ['Products · 160'] },
      },
    ],
  },
  'access-tiles': {
    'checks[].coverage.pages_sampled': [
      { change: (c) => (c.coverage!.pages_sampled = 48), expect: { access: ['48 of 214'] } },
    ],
    'checks[].coverage.pages_discovered': [
      { change: (c) => (c.coverage!.pages_discovered = 230), expect: { access: ['50 of 230'] } },
    ],
    'checks[].coverage.sample_strategy.max_pages': [
      {
        change: (c) => (c.coverage!.sample_strategy.max_pages = 60),
        expect: { access: ['at most 60, across every template'] },
      },
    ],
  },
  'access-kept': {
    'withheld[].total': [
      {
        change: (_, d) =>
          (d.withheld.find(
            (w) => w.check_id === CHECKS.badFirstAudit && w.collection === 'access_tests',
          )!.total = 412),
        expect: { access: ['Responses kept as evidence 412'] },
      },
    ],
  },
  'access-tested': {
    'checks[].tested_at': [
      {
        change: (c) => (c.tested_at = '2026-10-25T02:32:00Z'),
        expect: { access: ['Tested 25 Oct 2026 at 02:32 UTC.'] },
      },
    ],
  },
  'access-evidence': {
    'access_tests[].request_headers': [
      {
        change: (_, d) => opened(d).request_headers.push({ name: 'Accept-Language', value: 'en' }),
        expect: { access: ['Accept-Language: en'] },
      },
    ],
    'access_tests[].raw_status': [
      { change: (_, d) => (opened(d).raw_status = 429), expect: { access: ['Status 429'] } },
    ],
    'access_tests[].headers': [
      {
        change: (_, d) => opened(d).headers.push({ name: 'retry-after', value: '120' }),
        expect: { access: ['retry-after: 120'] },
      },
    ],
    'access_tests[].body_excerpt': [
      {
        change: (_, d) => (opened(d).body_excerpt = 'Sorry, you have been blocked'),
        expect: { access: ['Sorry, you have been blocked'] },
      },
    ],
    'access_tests[].tested_at': [
      {
        change: (_, d) => (opened(d).tested_at = '2026-10-25T02:33:19Z'),
        expect: { access: ['02:33:19 UTC'] },
      },
    ],
    'access_tests[].limitations': [
      {
        change: (_, d) =>
          (opened(d).limitations = ['Requested once; a second request may differ.']),
        expect: { access: ['Requested once; a second request may differ.'] },
      },
    ],
  },
  'access-fix': {
    'fixes[].title': [
      {
        change: (_, d) => (fix1(d).title = 'Let the AI crawlers through Cloudflare'),
        expect: { access: ['Let the AI crawlers through Cloudflare'] },
      },
    ],
    'fixes[].effect': [
      {
        change: (_, d) => (fix1(d).effect.ai_readability = 26),
        expect: { access: ['+26 AI readability, estimated'] },
      },
    ],
    'fixes[].effort': [
      {
        change: (_, d) => (fix1(d).effort = { kind: 'minutes', minutes: 15 }),
        expect: { access: ['about 15 minutes'] },
      },
    ],
    'fixes[].recommendation_class': [
      {
        change: (_, d) => (fix1(d).recommendation_class = 'documented_requirement'),
        expect: { access: ['documented platform requirement'] },
      },
    ],
    'fixes[].packet': [
      {
        change: (_, d) => fix1(d).packet!.change.push('Purge the Cloudflare cache.'),
        expect: { access: ['Purge the Cloudflare cache.'] },
      },
    ],
  },
};
