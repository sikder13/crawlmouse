import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemClock } from '../clock.js';
import { createFetcher, MAX_BODY_BYTES } from '../fetch/fetcher.js';
import { CRAWL } from '../identities.js';
import { startServer, type FixtureServer } from '../test-support/http.js';
import { outcome } from '../test-support/outcome.js';
import {
  MAX_ROBOTS_BYTES,
  crawlDelaySeconds,
  oursAllow,
  parseRobotsBody,
  readRobots,
  tokenAllows,
} from './robots.js';

const rules = (text: string) => parseRobotsBody(text);

describe('which groups bind our own requests', () => {
  it.each([
    ['User-agent: Crawlmouse\nDisallow: /private', '/private/x', false],
    ['User-agent: CrawlmouseBot\nDisallow: /private', '/private/x', false],
    ['user-agent: CRAWLMOUSE\ndisallow: /private', '/private/x', false],
    ['User-agent: crawlmousebot\nDisallow: /private', '/public', true],
  ])('%j on %s -> %s', (text, path, allowed) => expect(oursAllow(rules(text), path)).toBe(allowed));

  it('is allowed only if every one of our groups that exists allows it', () => {
    const r = rules('User-agent: Crawlmouse\nAllow: /\n\nUser-agent: CrawlmouseBot\nDisallow: /a');
    expect(oursAllow(r, '/a')).toBe(false);
    expect(oursAllow(r, '/b')).toBe(true);
  });

  it('falls back to * when neither of our tokens has a group', () => {
    expect(oursAllow(rules('User-agent: *\nDisallow: /x'), '/x/1')).toBe(false);
  });

  it('a group of ours replaces *, it does not add to it', () => {
    expect(
      oursAllow(rules('User-agent: *\nDisallow: /\n\nUser-agent: Crawlmouse\nAllow: /'), '/a'),
    ).toBe(true);
  });

  it("does not take another crawler's group as ours, whatever its name looks like", () => {
    for (const other of ['GPTBot', 'Crawlmouse-Lab', 'MouseCrawler', 'crawlmousebot2']) {
      expect(oursAllow(rules(`User-agent: ${other}\nDisallow: /`), '/a')).toBe(true);
    }
  });

  it('no robots.txt allows everything', () => {
    expect(oursAllow(null, '/anything')).toBe(true);
    expect(tokenAllows(null, 'GPTBot', '/anything')).toBe(true);
  });
});

describe("a crawler's own group", () => {
  it("uses the crawler's group, case-insensitively, else *", () => {
    const r = rules('User-agent: gptbot\nDisallow: /\n\nUser-agent: *\nDisallow: /search');
    expect(tokenAllows(r, 'GPTBot', '/a')).toBe(false);
    expect(tokenAllows(r, 'ClaudeBot', '/a')).toBe(true);
    expect(tokenAllows(r, 'ClaudeBot', '/search')).toBe(false);
  });
});

describe('Crawl-delay', () => {
  it('takes the largest delay among our groups and the tokens in play', () => {
    const r = rules(
      'User-agent: Crawlmouse\nCrawl-delay: 2\n\nUser-agent: GPTBot\nCrawl-delay: 7\n\nUser-agent: *\nCrawl-delay: 20',
    );
    expect(crawlDelaySeconds(r, [])).toBe(2);
    expect(crawlDelaySeconds(r, ['GPTBot'])).toBe(7);
    // ClaudeBot has no group of its own, so * binds it.
    expect(crawlDelaySeconds(r, ['GPTBot', 'ClaudeBot'])).toBe(20);
  });

  it('is null when nothing declares one, and ignores a negative or non-numeric value', () => {
    expect(crawlDelaySeconds(rules('User-agent: *\nDisallow: /x'), ['GPTBot'])).toBeNull();
    expect(
      crawlDelaySeconds(rules('User-agent: *\nCrawl-delay: -3\nCrawl-delay: soon'), []),
    ).toBeNull();
  });
});

describe('parseRobotsBody: text as served', () => {
  it('reads a BOM, CRLF and lone-CR line endings', () => {
    for (const eol of ['\r\n', '\r', '\n']) {
      const r = rules(`﻿User-agent: Crawlmouse${eol}Disallow: /a${eol}`);
      expect(oursAllow(r, '/a')).toBe(false);
    }
  });

  it('stops reading at the size cap instead of taking unbounded rules', () => {
    const filler = '# ' + 'x'.repeat(MAX_ROBOTS_BYTES) + '\n';
    expect(oursAllow(rules(`${filler}User-agent: *\nDisallow: /`), '/a')).toBe(true);
  });
});

describe('readRobots: what a fetch outcome means', () => {
  const ok = (body: string, contentType = 'text/plain') =>
    outcome({ body, headers: { 'content-type': contentType } });

  it('a text/plain 200 is rules', () => {
    expect(readRobots(ok('User-agent: *\nDisallow: /')).state).toBe('rules');
  });

  it('an HTML 200 is a soft 404, not rules', () => {
    expect(readRobots(ok('<html>home</html>', 'text/html'))).toMatchObject({
      state: 'none',
      why: 'html_soft_404',
    });
  });

  it.each([400, 401, 403, 404, 410, 429])('a %i means no robots.txt: allow all', (status) => {
    expect(readRobots(outcome({ status, body: '' }))).toMatchObject({
      state: 'none',
      why: 'client_error',
    });
  });

  it.each([500, 502, 503])('a %i is unreachable', (status) => {
    expect(readRobots(outcome({ status, body: '' }))).toMatchObject({
      state: 'unreachable',
      why: 'server_error',
    });
  });

  it.each([
    ['timeout', 'timeout'],
    ['network', 'network'],
    ['dns_failed', 'network'],
    ['redirect_limit', 'network'],
    ['too_large', 'network'],
  ] as const)('a %s error is unreachable (%s)', (error, why) => {
    const f = outcome({ status: null, finalUrl: null, error });
    expect(readRobots(f)).toMatchObject({ state: 'unreachable', why });
  });

  it('a challenge served in place of robots.txt is unreachable, not "no rules"', () => {
    const f = outcome({ status: 403, headers: { 'cf-mitigated': 'challenge' }, body: '' });
    expect(readRobots(f)).toMatchObject({ state: 'unreachable', why: 'challenged' });
  });

  it('an SSRF refusal is a refusal, not a robots answer', () => {
    expect(readRobots(outcome({ status: null, finalUrl: null, error: 'ssrf_refused' })).state).toBe(
      'refused',
    );
  });
});

describe('robots.txt over HTTP, as servers send it', () => {
  let server: FixtureServer;
  const fetcher = createFetcher(systemClock, { bypassSsrf: true });
  const body = 'User-agent: Crawlmouse\nDisallow: /private\n';
  beforeAll(async () => {
    server = await startServer((req, res) => {
      switch (req.url) {
        case '/plain/robots.txt':
          res.setHeader('content-type', 'text/plain; charset=utf-8');
          return res.end(body);
        case '/nocharset/robots.txt':
          res.setHeader('content-type', 'text/plain');
          return res.end(body);
        case '/gz/robots.txt':
          res.setHeader('content-type', 'text/plain');
          res.setHeader('content-encoding', 'gzip');
          return res.end(gzipSync(body));
        case '/redir/robots.txt':
          res.statusCode = 301;
          res.setHeader('location', '/plain/robots.txt');
          return res.end();
        default:
          res.statusCode = 404;
          return res.end();
      }
    });
  });
  afterAll(() => server.close());

  it.each(['plain', 'nocharset', 'gz', 'redir'])(
    'reads a text/plain robots.txt (%s) and applies it',
    async (dir) => {
      const f = await fetcher(`${server.base}/${dir}/robots.txt`, CRAWL, {
        maxBytes: MAX_BODY_BYTES,
        deadlineMs: 5000,
      });
      const reading = readRobots(f);
      expect(reading.state).toBe('rules');
      if (reading.state !== 'rules') return;
      expect(oursAllow(reading.rules, '/private/1')).toBe(false);
      expect(oursAllow(reading.rules, '/public')).toBe(true);
    },
  );
});
