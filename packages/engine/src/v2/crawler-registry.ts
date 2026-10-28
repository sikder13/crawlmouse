/**
 * CC-11 — seed data for the eight crawlers the v2 product tracks (FACTS I6): two search engines read
 * by robots.txt only, four scored AI search crawlers, two unscored AI training crawlers.
 *
 * Tokens, user agents, robots tokens, IP lists and verification methods were read from each
 * operator's own page on `as_of`; where a page leaves something unstated, `source_notes` says so
 * rather than filling it in. The operator and purpose of the six AI crawlers are not retyped: they come
 * from AI_BOT_REGISTRY, so the two registries cannot disagree about who runs a crawler or what it is
 * for.
 *
 * The array is built when this module is imported, and `fromV1` throws then if AI_BOT_REGISTRY no
 * longer lists one of these crawlers. That is deliberate: the drift fails anything that imports this
 * module (today, only its tests) instead of producing an entry with a missing operator.
 */
import type { CrawlerGroup, CrawlerRegistryEntry } from '@crawlmouse/types/v2';
import { AI_BOT_REGISTRY } from '../analysis/ai-readiness/constants.js';

const AS_OF = '2026-10-27';

const OPENAI_SOURCE = 'https://developers.openai.com/api/docs/bots';
const ANTHROPIC_SOURCE =
  'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler';
const ANTHROPIC_IPS = 'https://claude.com/crawling/bots.json';

/** v1 classes map onto the v2 groups; opt-out tokens are not crawlers and are never tracked here. */
const GROUP_FOR_CLASS = { retrieval: 'ai_search', training: 'ai_training' } as const;

type AiFields = Omit<CrawlerRegistryEntry, 'token' | 'group' | 'scored' | 'operator' | 'purpose'>;

function fromV1(token: string, fields: AiFields): CrawlerRegistryEntry {
  const v1 = AI_BOT_REGISTRY.find((b) => b.token === token);
  if (!v1 || v1.botClass === 'opt_out_token') {
    throw new Error(`crawler-registry: ${token} is not an AI crawler in AI_BOT_REGISTRY`);
  }
  const group: CrawlerGroup = GROUP_FOR_CLASS[v1.botClass];
  return {
    token,
    group,
    scored: group === 'ai_search',
    operator: v1.operator,
    purpose: v1.note,
    ...fields,
  };
}

export const CRAWLER_REGISTRY_V2: readonly CrawlerRegistryEntry[] = [
  {
    token: 'Googlebot',
    group: 'search_engine',
    scored: false,
    operator: 'Google',
    purpose:
      "Google Search's crawler. It renders JavaScript, and Search indexes mostly what its smartphone variant fetches.",
    robots_token: 'Googlebot',
    ua_string:
      'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/W.X.Y.Z Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    verification_method: ['ip_list', 'reverse_dns'],
    ip_list_url: 'https://developers.google.com/static/crawling/ipranges/common-crawlers.json',
    testable: false,
    needs_owner_logs: true,
    source_url:
      'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers',
    source_notes: [
      'The smartphone user agent is recorded; Google also documents a desktop one. W.X.Y.Z stands for the Chrome version, which Google says to match with a wildcard.',
      'Reverse DNS resolves to googlebot.com (verification page: developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests).',
      'Google moved these pages from /search/docs/crawling-indexing/ to /crawling/docs/crawlers-fetchers/.',
    ],
    as_of: AS_OF,
  },
  {
    token: 'Bingbot',
    group: 'search_engine',
    scored: false,
    operator: 'Microsoft',
    purpose: "Bing's standard crawler, which does most of Bing's crawling.",
    robots_token: 'bingbot',
    ua_string:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/W.X.Y.Z Safari/537.36',
    verification_method: ['ip_list', 'reverse_dns'],
    ip_list_url: 'https://www.bing.com/toolbox/bingbot.json',
    testable: false,
    needs_owner_logs: true,
    source_url: 'https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0',
    source_notes: [
      'The page names no robots.txt token; "bingbot" is the product token in the user agent, and robots.txt matching ignores case.',
      'The desktop user agent is recorded. W.X.Y.Z stands for the current Microsoft Edge version.',
      'Reverse DNS resolves to search.msn.com; Bing asks for the IP list to be refreshed daily.',
      'The article body is rendered in the browser; it was read from the content endpoint the page itself calls.',
    ],
    as_of: AS_OF,
  },
  fromV1('OAI-SearchBot', {
    robots_token: 'OAI-SearchBot',
    ua_string:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot',
    verification_method: ['ip_list'],
    ip_list_url: 'https://openai.com/searchbot.json',
    testable: true,
    needs_owner_logs: true,
    source_url: OPENAI_SOURCE,
    source_notes: [
      'OpenAI labels the string an example whose version may change.',
      'OpenAI says a robots.txt change can take about 24 hours to apply to search.',
    ],
    as_of: AS_OF,
  }),
  fromV1('ChatGPT-User', {
    robots_token: 'ChatGPT-User',
    ua_string:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
    verification_method: ['ip_list'],
    ip_list_url: 'https://openai.com/chatgpt-user.json',
    testable: true,
    needs_owner_logs: true,
    source_url: OPENAI_SOURCE,
    source_notes: [
      'OpenAI says robots.txt rules may not apply to these user-initiated fetches, and points to OAI-SearchBot for search opt-outs.',
    ],
    as_of: AS_OF,
  }),
  fromV1('PerplexityBot', {
    robots_token: 'PerplexityBot',
    ua_string:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
    verification_method: ['ip_list'],
    ip_list_url: 'https://www.perplexity.com/perplexitybot.json',
    testable: true,
    needs_owner_logs: true,
    source_url: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers',
    source_notes: [
      'Perplexity says robots.txt changes may take up to 24 hours to apply.',
      'The documented IP list URL currently redirects to perplexity.ai.',
    ],
    as_of: AS_OF,
  }),
  fromV1('Claude-SearchBot', {
    robots_token: 'Claude-SearchBot',
    ua_string: null,
    verification_method: ['ip_list'],
    ip_list_url: ANTHROPIC_IPS,
    testable: true,
    needs_owner_logs: true,
    source_url: ANTHROPIC_SOURCE,
    source_notes: [
      "Anthropic's page prints no user-agent string for this crawler.",
      "The page names the bot but gives no robots.txt example for it; the token is the bot's name.",
      'The IP list is shared by all Anthropic crawlers and does not say which crawler uses which address.',
    ],
    as_of: AS_OF,
  }),
  fromV1('GPTBot', {
    robots_token: 'GPTBot',
    ua_string:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot',
    verification_method: ['ip_list'],
    ip_list_url: 'https://openai.com/gptbot.json',
    testable: true,
    needs_owner_logs: true,
    source_url: OPENAI_SOURCE,
    source_notes: ['OpenAI labels the string an example whose version may change.'],
    as_of: AS_OF,
  }),
  fromV1('ClaudeBot', {
    robots_token: 'ClaudeBot',
    ua_string: null,
    verification_method: ['ip_list'],
    ip_list_url: ANTHROPIC_IPS,
    testable: true,
    needs_owner_logs: true,
    source_url: ANTHROPIC_SOURCE,
    source_notes: [
      "Anthropic's page prints no user-agent string for this crawler.",
      'The IP list is shared by all Anthropic crawlers and does not say which crawler uses which address.',
    ],
    as_of: AS_OF,
  }),
];
