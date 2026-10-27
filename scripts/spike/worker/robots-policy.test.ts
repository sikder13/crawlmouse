import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { safeFetch } from '../../../packages/engine/src/safe-fetch.js';
import {
  parseRobotsBody,
  allowedForOurTokens,
  crawlDelayForOurTokens,
  hostGapMs,
  loadRobots,
  MAX_ROBOTS_BYTES,
} from './robots-policy.js';

const p = (t: string) => parseRobotsBody(t);

describe('which group applies to our tokens', () => {
  it('uses the Crawlmouse group when only that one exists', () => {
    const r = p('User-agent: Crawlmouse\nDisallow: /private\n\nUser-agent: *\nDisallow: /\n');
    expect(allowedForOurTokens(r, '/private/x')).toBe(false);
    expect(allowedForOurTokens(r, '/open')).toBe(true); // the * group does not apply once ours exists
  });
  it('uses the CrawlmouseBot group when only that one exists', () => {
    const r = p('User-agent: CrawlmouseBot\nDisallow: /b\n\nUser-agent: *\nDisallow: /\n');
    expect(allowedForOurTokens(r, '/b/1')).toBe(false);
    expect(allowedForOurTokens(r, '/c')).toBe(true);
  });
  it('is allowed only if every present group of ours allows it', () => {
    const r = p('User-agent: Crawlmouse\nDisallow: /a\n\nUser-agent: CrawlmouseBot\nDisallow: /b\n');
    expect(allowedForOurTokens(r, '/a')).toBe(false);
    expect(allowedForOurTokens(r, '/b')).toBe(false);
    expect(allowedForOurTokens(r, '/c')).toBe(true);
  });
  it('falls back to * when neither token has a group', () => {
    const r = p('User-agent: *\nDisallow: /nope\n');
    expect(allowedForOurTokens(r, '/nope/1')).toBe(false);
    expect(allowedForOurTokens(r, '/ok')).toBe(true);
  });
  it('does not confuse a longer token for ours (GPTBot rules do not bind Crawlmouse)', () => {
    const r = p('User-agent: GPTBot\nDisallow: /\n');
    expect(allowedForOurTokens(r, '/anything')).toBe(true);
  });
  it('treats a missing robots.txt as allow-all', () => {
    expect(allowedForOurTokens(null, '/x')).toBe(true);
  });
});

describe('Crawl-delay', () => {
  it('takes the largest delay among our present groups, else *', () => {
    expect(crawlDelayForOurTokens(p('User-agent: Crawlmouse\nCrawl-delay: 3\n\nUser-agent: CrawlmouseBot\nCrawl-delay: 5\n'))).toBe(5);
    expect(crawlDelayForOurTokens(p('User-agent: *\nCrawl-delay: 2\n'))).toBe(2);
    expect(crawlDelayForOurTokens(p('User-agent: Crawlmouse\nDisallow: /x\n\nUser-agent: *\nCrawl-delay: 9\n'))).toBeUndefined();
    expect(crawlDelayForOurTokens(null)).toBeUndefined();
  });

  it('host gap = max(500 ms, ours, every token in play): the css-tricks 1 s case', () => {
    const r = p('User-agent: *\nCrawl-delay: 1\n');
    expect(hostGapMs(r, [])).toBe(1000);
    expect(hostGapMs(p('User-agent: *\nDisallow: /x\n'), [])).toBe(500);
  });
  it('access-test tokens raise the gap when their own group declares a delay', () => {
    const r = p('User-agent: GPTBot\nCrawl-delay: 4\n\nUser-agent: *\nDisallow:\n');
    expect(hostGapMs(r, [])).toBe(500);
    expect(hostGapMs(r, ['GPTBot'])).toBe(4000);
    expect(hostGapMs(r, ['ClaudeBot'])).toBe(500);
  });
  it('never shortens a declared delay: 10 s stays 10 s, 60 s stays 60 s', () => {
    expect(hostGapMs(p('User-agent: *\nCrawl-delay: 10\n'), [])).toBe(10_000);
    expect(hostGapMs(p('User-agent: *\nCrawl-delay: 60\n'), [])).toBe(60_000);
  });
  it('ignores a negative or non-numeric delay', () => {
    expect(hostGapMs(p('User-agent: *\nCrawl-delay: -3\n'), [])).toBe(500);
    expect(hostGapMs(p('User-agent: *\nCrawl-delay: soon\n'), [])).toBe(500);
  });
});

describe('parseRobotsBody: text/plain bytes as served', () => {
  it('reads a BOM, CRLF, and lone-CR line endings', () => {
    const body = '﻿User-agent: Crawlmouse\r\nDisallow: /crlf\r\n\r\nUser-agent: CrawlmouseBot\rDisallow: /cr\r';
    const r = p(body);
    expect(allowedForOurTokens(r, '/crlf')).toBe(false);
    expect(allowedForOurTokens(r, '/cr')).toBe(false);
  });
  it('is case-insensitive on directive names and tokens', () => {
    const r = p('USER-AGENT: CRAWLMOUSEBOT\nDISALLOW: /x\n');
    expect(allowedForOurTokens(r, '/x')).toBe(false);
  });
  it('ignores comments and trailing whitespace', () => {
    const r = p('User-agent: Crawlmouse   # us\nDisallow: /x   # nope\n');
    expect(allowedForOurTokens(r, '/x')).toBe(false);
  });
  it('truncates at the size cap instead of reading unbounded rules', () => {
    const pad = '#'.repeat(MAX_ROBOTS_BYTES);
    const r = p(`${pad}\nUser-agent: Crawlmouse\nDisallow: /late\n`);
    expect(allowedForOurTokens(r, '/late')).toBe(true);
    expect(MAX_ROBOTS_BYTES).toBe(512 * 1024);
  });
});

describe('loadRobots over HTTP', () => {
  let server: http.Server;
  let base: string;
  const rules = 'User-agent: Crawlmouse\nDisallow: /secret\nCrawl-delay: 2\n';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      switch (req.url) {
        case '/plain/robots.txt':
          res.setHeader('content-type', 'text/plain; charset=utf-8');
          res.end(rules);
          break;
        case '/gz/robots.txt':
          res.setHeader('content-type', 'text/plain');
          res.setHeader('content-encoding', 'gzip');
          res.end(gzipSync(Buffer.from(rules)));
          break;
        case '/nocharset/robots.txt':
          res.setHeader('content-type', 'text/plain');
          res.end('﻿' + rules.replace(/\n/g, '\r\n'));
          break;
        case '/html/robots.txt':
          res.setHeader('content-type', 'text/html');
          res.end('<html><body>User-agent: *\nDisallow: /</body></html>');
          break;
        case '/redir/robots.txt':
          res.statusCode = 301;
          res.setHeader('location', '/plain/robots.txt');
          res.end();
          break;
        case '/e404/robots.txt':
          res.statusCode = 404;
          res.end('nope');
          break;
        case '/e403/robots.txt':
          res.statusCode = 403;
          res.end('nope');
          break;
        case '/e503/robots.txt':
          res.statusCode = 503;
          res.end('later');
          break;
        default:
          res.statusCode = 404;
          res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const fetchText = (url: string) => safeFetch(url, { bypassSsrf: true });

  it.each(['plain', 'gz', 'nocharset', 'redir'])('reads a text/plain robots.txt (%s) and applies its rules', async (dir) => {
    const r = await loadRobots(`${base}/${dir}`, fetchText);
    expect(r.state).toBe('rules');
    expect(allowedForOurTokens(r.parsed, '/secret/1')).toBe(false);
    expect(allowedForOurTokens(r.parsed, '/open')).toBe(true);
    expect(crawlDelayForOurTokens(r.parsed)).toBe(2);
  });

  it('does not take rules from an HTML body served with 200 (a soft 404)', async () => {
    const r = await loadRobots(`${base}/html`, fetchText);
    expect(r.state).toBe('absent');
    expect(allowedForOurTokens(r.parsed, '/x')).toBe(true);
  });

  it('404 and 403 mean no robots.txt (RFC 9309 unavailable), allow-all', async () => {
    for (const d of ['e404', 'e403']) {
      const r = await loadRobots(`${base}/${d}`, fetchText);
      expect(r.state).toBe('absent');
      expect(allowedForOurTokens(r.parsed, '/x')).toBe(true);
    }
  });

  it('5xx is treated as complete disallow for this batch', async () => {
    const r = await loadRobots(`${base}/e503`, fetchText);
    expect(r.state).toBe('unreachable');
    expect(allowedForOurTokens(r.parsed, '/x')).toBe(false);
  });

  it('a network error is also complete disallow', async () => {
    const r = await loadRobots(`${base}/x`, async () => {
      throw new Error('socket hang up');
    });
    expect(r.state).toBe('unreachable');
    expect(allowedForOurTokens(r.parsed, '/')).toBe(false);
  });

  it('an SSRF refusal is not a robots answer: it is reported, not swallowed as allow-all', async () => {
    const r = await loadRobots('http://169.254.169.254', (u) => safeFetch(u));
    expect(r.state).toBe('unreachable');
  });
});
