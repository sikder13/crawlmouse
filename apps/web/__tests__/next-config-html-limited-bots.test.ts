import { describe, expect, it } from 'vitest';
import config from '../next.config.mjs';

// CC-40 ruling 4: Next streams a per-request page's metadata into <body> for any user agent its
// `htmlLimitedBots` pattern does not match. Crawlers that do not run JavaScript then find no
// <title>, description or canonical in <head>, so every agent below must match. A pattern narrowed
// to a list of named bots fails on the agents it leaves out.
const AGENTS: Record<string, string> = {
  GPTBot:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)',
  'OAI-SearchBot':
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
  ClaudeBot:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  PerplexityBot:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  Googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Chrome desktop':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

describe('next.config.mjs htmlLimitedBots', () => {
  const pattern = (config as { htmlLimitedBots?: RegExp }).htmlLimitedBots;

  it('is set on the exported config', () => {
    expect(pattern).toBeInstanceOf(RegExp);
  });

  it.each(Object.entries(AGENTS))('matches %s, so it gets its metadata in <head>', (_, ua) => {
    expect(pattern!.test(ua)).toBe(true);
  });
});
