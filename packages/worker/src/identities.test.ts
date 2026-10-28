import { describe, expect, it } from 'vitest';
import { CRAWLER_REGISTRY_V2 } from '@crawlmouse/engine/worker';
import { BROWSER_USER_AGENT, CANARY, CONTROL, CRAWL, CRAWLERS, FROM, TAG } from './identities.js';

const header = (headers: ReadonlyArray<readonly [string, string]>, name: string) =>
  headers.find(([n]) => n === name)?.[1];

describe('identities', () => {
  it('tests exactly the crawlers the registry marks testable, in registry order', () => {
    const testable = CRAWLER_REGISTRY_V2.filter((e) => e.testable).map((e) => e.token);
    expect(CRAWLERS.map((c) => c.token)).toEqual(testable);
    expect(testable).toEqual([
      'OAI-SearchBot',
      'ChatGPT-User',
      'PerplexityBot',
      'Claude-SearchBot',
      'GPTBot',
      'ClaudeBot',
    ]);
  });

  it("sends a crawler's own registry user agent with the tag appended", () => {
    for (const c of CRAWLERS) {
      const entry = CRAWLER_REGISTRY_V2.find((e) => e.token === c.token)!;
      expect(c.userAgent).toBe(`${entry.ua_string ?? entry.token} ${TAG}`);
      expect(c.robotsToken).toBe(entry.robots_token);
    }
  });

  it('sends the bare token where the registry prints no user agent, never an invented one', () => {
    const claudeBot = CRAWLERS.find((c) => c.token === 'ClaudeBot')!;
    expect(claudeBot.userAgent).toBe('ClaudeBot Crawlmouse/2.0 (+https://crawlmouse.com/bot)');
  });

  it("our crawl identity is the owner's string with a From address", () => {
    expect(CRAWL.userAgent).toBe(
      'Mozilla/5.0 (compatible; Crawlmouse/2.0; +https://crawlmouse.com/bot)',
    );
    expect(header(CRAWL.headers, 'From')).toBe('bot@crawlmouse.com');
  });

  it('the control is an untagged browser: no tag, no From', () => {
    expect(CONTROL.userAgent).toBe(BROWSER_USER_AGENT);
    expect(CONTROL.userAgent).not.toContain('Crawlmouse');
    expect(header(CONTROL.headers, 'From')).toBeUndefined();
    expect(CONTROL.token).toBeNull();
  });

  it("the canary is Google's documented Googlebot string with a concrete Chrome version, tagged", () => {
    expect(CANARY.token).toBe('Googlebot');
    expect(CANARY.userAgent).toContain(
      '(compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    );
    expect(CANARY.userAgent).not.toContain('W.X.Y.Z');
    expect(CANARY.userAgent.endsWith(` ${TAG}`)).toBe(true);
  });

  it('every tagged identity carries From, and every identity sends the same four header names', () => {
    for (const id of [CRAWL, CANARY, ...CRAWLERS]) expect(header(id.headers, 'From')).toBe(FROM);
    for (const id of [CRAWL, CONTROL, CANARY, ...CRAWLERS]) {
      expect(id.headers.map(([n]) => n).slice(0, 3)).toEqual([
        'User-Agent',
        'Accept',
        'Accept-Encoding',
      ]);
      expect(header(id.headers, 'User-Agent')).toBe(id.userAgent);
    }
  });
});
