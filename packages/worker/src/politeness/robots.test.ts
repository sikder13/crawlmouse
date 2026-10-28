import { parseRobotsTxt } from '@crawlmouse/engine/worker';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Budget } from '../batch/budget.js';
import { politeFetch } from '../batch/polite-fetch.js';
import { createFetcher } from '../fetch/fetcher.js';
import { CRAWL } from '../identities.js';
import { InstantClock } from '../test-support/clock.js';
import { Sites } from './sites.js';
import { startServer, type FixtureServer } from '../test-support/http.js';
import { outcome } from '../test-support/outcome.js';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import {
  MAX_ROBOTS_BYTES,
  MAX_ROBOTS_RULES,
  crawlDelaySeconds,
  oursAllow,
  readRobots,
  tokenAllows,
} from './robots.js';

const rules = (text: string) => parseRobotsTxt(text);

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

describe('parseRobotsTxt: text as served', () => {
  it('reads a BOM, CRLF and lone-CR line endings', () => {
    for (const eol of ['\r\n', '\r', '\n']) {
      const r = rules(`﻿User-agent: Crawlmouse${eol}Disallow: /a${eol}`);
      expect(oursAllow(r, '/a')).toBe(false);
    }
  });
});

describe('parseRobotsTxt: hostile group names', () => {
  // Every name Object.prototype holds, in three casings, under each directive the parser writes.
  const names = Object.getOwnPropertyNames(Object.prototype);
  const casings = (n: string) => [n, n.toLowerCase(), n.toUpperCase()];

  it.each(names)('a group named %s cannot reach Object.prototype or break the file', (name) => {
    for (const agent of casings(name)) {
      for (const directive of ['Crawl-delay: 7', 'Disallow: /', 'Allow: /x']) {
        const text = `\uFEFFUser-agent: ${agent}  # hostile\n${directive}\n\nUser-agent: *\nDisallow: /private\n`;
        const parsed = parseRobotsTxt(text);
        expect(({} as Record<string, unknown>).crawlDelay).toBeUndefined();
        expect(({} as Record<string, unknown>).disallow).toBeUndefined();
        expect(oursAllow(parsed, '/private/1')).toBe(false);
        expect(oursAllow(parsed, '/public')).toBe(true);
      }
    }
  });

  it('leaves real groups alone, whatever their case', () => {
    const r = parseRobotsTxt('User-agent: GPTBot\nDisallow: /\n');
    expect(tokenAllows(r, 'GPTBot', '/a')).toBe(false);
  });
});

describe('parseRobotsTxt: groups as the worker reads them', () => {
  // Each stored group once: agents named together share one.
  const stored = (r: ReturnType<typeof parseRobotsTxt>) =>
    [...new Set(Object.values(r.rules))].reduce(
      (n, g) => n + g.disallow.length + g.allow.length,
      0,
    );

  it('parses a file of one group of 5,000 agents and thousands of rules in proportion to it', () => {
    const agents = Array.from({ length: 5000 }, (_, i) => `User-agent: bot${i}`).join('\n');
    let rules = '';
    let ruleLines = 0;
    while (Buffer.byteLength(agents) + rules.length < MAX_ROBOTS_BYTES - 64) {
      rules += `\nDisallow: /p${ruleLines++}`;
    }
    const t0 = Date.now();
    const parsed = parseRobotsTxt(`${agents}${rules}\nUser-agent: *\nDisallow: /private`);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(ruleLines).toBeGreaterThan(10_000);
    expect(stored(parsed)).toBeLessThanOrEqual(ruleLines + 1);
    expect(oursAllow(parsed, '/private/x')).toBe(false);
  });

  it("keeps a group's meaning for the agents the worker reads, whatever their spelling", () => {
    for (const spelling of ['GPTBot', 'gptbot', 'GPTBOT']) {
      const r = parseRobotsTxt(
        `User-agent: other\nUser-agent: ${spelling}\nUser-agent: more\nDisallow: /\n`,
      );
      expect(tokenAllows(r, 'GPTBot', '/a')).toBe(false);
      expect(tokenAllows(r, 'ClaudeBot', '/a')).toBe(true);
    }
  });

  it('keeps group boundaries: a later group does not inherit an earlier one', () => {
    const r = parseRobotsTxt(
      'User-agent: other\nDisallow: /x\n\nUser-agent: another\n# note\nUser-agent: GPTBot\nDisallow: /y\n',
    );
    expect(tokenAllows(r, 'GPTBot', '/x')).toBe(true);
    expect(tokenAllows(r, 'GPTBot', '/y')).toBe(false);
  });

  it('a group of agents the worker does not read binds none of its requests', () => {
    const r = parseRobotsTxt('User-agent: SomeBot\nUser-agent: OtherBot\nDisallow: /\n');
    expect(oursAllow(r, '/a')).toBe(true);
    expect(tokenAllows(r, 'GPTBot', '/a')).toBe(true);
  });
});

describe('readRobots: a robots.txt too large to evaluate', () => {
  const text = (body: string) => outcome({ body, headers: { 'content-type': 'text/plain' } });
  const group = (agent: string, n: number) =>
    `User-agent: ${agent}\n${Array.from({ length: n }, (_, i) => `Disallow: /${agent}${i}`).join('\n')}\n`;

  it('reads a file of exactly 500 KiB (512,000 bytes), and not one byte more', () => {
    const head = 'User-agent: *\nDisallow: /x\n';
    const exact = head + '#'.repeat(512_000 - head.length);
    expect(readRobots(text(exact)).state).toBe('rules');
    expect(readRobots(text(`${exact}#`))).toMatchObject({ state: 'too_large', why: 'bytes' });
  });

  it('counts the size as the engine does: UTF-8 bytes after a leading BOM', () => {
    const head = 'User-agent: *\nDisallow: /x\n';
    const exact = head + '#'.repeat(512_000 - head.length);
    expect(readRobots(text(`\uFEFF${exact}`)).state).toBe('rules');
    expect(readRobots(text(`\uFEFF${exact}#`))).toMatchObject({ state: 'too_large', why: 'bytes' });
    // Counted in UTF-8, not in characters: é is two bytes.
    const room = 512_000 - head.length;
    const twoByte = head + '#'.repeat(room % 2) + 'é'.repeat(Math.floor(room / 2));
    expect(Buffer.byteLength(twoByte)).toBe(512_000);
    expect(readRobots(text(twoByte)).state).toBe('rules');
    expect(readRobots(text(`${twoByte}é`))).toMatchObject({ state: 'too_large', why: 'bytes' });
  });

  it('a request cut off at the size cap is too large to evaluate', () => {
    const f = outcome({
      status: null,
      finalUrl: null,
      error: 'too_large',
      maxBytes: MAX_ROBOTS_BYTES,
    });
    expect(readRobots(f)).toMatchObject({ state: 'too_large', why: 'bytes' });
  });

  it("a request cut off by what the batch's byte budget had left is unreachable, not too large", () => {
    const f = outcome({ status: null, finalUrl: null, error: 'too_large', maxBytes: 1000 });
    expect(readRobots(f)).toMatchObject({ state: 'unreachable', why: 'byte_budget' });
  });

  it('reads 5,000 rules in a group the worker reads, and not one more', () => {
    expect(readRobots(text(group('*', 5000))).state).toBe('rules');
    expect(readRobots(text(group('*', 5001)))).toMatchObject({
      state: 'too_large',
      why: 'rules',
    });
    expect(readRobots(text(group('GPTBot', 5001)))).toMatchObject({
      state: 'too_large',
      why: 'rules',
    });
  });

  it('counts each group on its own, and only the groups the worker reads', () => {
    const many = group('*', MAX_ROBOTS_RULES) + group('Googlebot', MAX_ROBOTS_RULES);
    expect(readRobots(text(many)).state).toBe('rules');
    expect(
      readRobots(text(`${group('SomeBot', 3 * MAX_ROBOTS_RULES)}${group('*', 1)}`)).state,
    ).toBe('rules');
  });

  it('counts rules stated before any User-agent line toward *', () => {
    const before = Array.from({ length: MAX_ROBOTS_RULES + 1 }, (_, i) => `Disallow: /b${i}`).join(
      '\n',
    );
    expect(readRobots(text(before))).toMatchObject({ state: 'too_large', why: 'rules' });
  });
});

describe('readRobots: a hostile robots.txt costs time in proportion to its size', () => {
  // Review round 3 measured the regex parse on one such run: 160,000 characters took 43.5 s, and
  // 40,000 took 3.9 s. A run of 100,000 is parsed once, not once per character.
  it.each([
    ['#', '\u2028'],
    ['#', '\u2029'],
    ['#', '\r'],
    [' ', '\u2028'],
  ])(
    'reads 500 KiB of %j runs of 100,000 broken by %j in under a second',
    (run, breaker) => {
      const piece = `${run.repeat(100_000)}${breaker}`;
      const head = 'User-agent: *\nDisallow: /x\nDisallow: /';
      const body =
        head +
        piece.repeat(Math.floor((MAX_ROBOTS_BYTES - head.length) / Buffer.byteLength(piece)));
      const t = performance.now();
      const r = readRobots(outcome({ body, headers: { 'content-type': 'text/plain' } }));
      expect(performance.now() - t).toBeLessThan(1000);
      expect(r.state).toBe('rules');
    },
    10_000,
  );
});

describe('readRobots: what a reading keeps', () => {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;

  it('keeps only the groups the worker reads', () => {
    const r = readRobots(
      outcome({
        body: 'User-agent: SomeBot\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /g\n\nUser-agent: *\nDisallow: /s\n',
        headers: { 'content-type': 'text/plain' },
      }),
    );
    if (r.state !== 'rules') throw new Error(r.state);
    expect(Object.keys(r.rules.rules).sort()).toEqual(['*', 'gptbot']);
    expect(tokenAllows(r.rules, 'GPTBot', '/g')).toBe(false);
    expect(oursAllow(r.rules, '/s')).toBe(false);
  });

  it('holds what it keeps, not the file it was read from', () => {
    // Near the size cap, almost all of it rules for an agent the worker does not read.
    // The kept rule is long enough that V8 would hold a slice of it as a view into the file.
    let body =
      'User-agent: *\nDisallow: /a-kept-path-long-enough-to-be-a-view\n\nUser-agent: SomeBot\n';
    for (let i = 0; Buffer.byteLength(body) < MAX_ROBOTS_BYTES - 64; i++)
      body += `Disallow: /x${i}\n`;
    gc();
    gc();
    const before = process.memoryUsage().heapUsed;
    // Twenty distinct files, each read from a body of its own.
    const readings = Array.from({ length: 20 }, (_, i) =>
      readRobots(outcome({ body: `${body}# ${i}\n`, headers: { 'content-type': 'text/plain' } })),
    );
    gc();
    gc();
    const held = (process.memoryUsage().heapUsed - before) / 1048576;
    expect(readings.every((r) => r.state === 'rules')).toBe(true);
    // Each file is 0.5 MiB; parsed whole, 20 of them held 20 MiB or more.
    expect(held).toBeLessThan(2);
  });
});

describe('readRobots: what a fetch outcome means', () => {
  const ok = (body: string, contentType = 'text/plain') =>
    outcome({ body, headers: { 'content-type': contentType } });

  it('a text/plain 200 is rules', () => {
    expect(readRobots(ok('User-agent: *\nDisallow: /')).state).toBe('rules');
  });

  it('rules served as text/html are still rules: the body decides, not the header', () => {
    const r = readRobots(ok('User-agent: *\nDisallow: /private', 'text/html'));
    expect(r.state).toBe('rules');
    if (r.state === 'rules') expect(oursAllow(r.rules, '/private/x')).toBe(false);
  });

  it('a rules file with a tag later in it is still a rules file', () => {
    expect(
      readRobots(ok('User-agent: *\n# see <b>docs</b>\nDisallow: /x', 'text/plain')).state,
    ).toBe('rules');
  });

  it('an HTML page served as text/plain is still a soft 404', () => {
    expect(readRobots(ok('\n  <!doctype html><html>home</html>', 'text/plain'))).toMatchObject({
      state: 'none',
      why: 'html_soft_404',
    });
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
  const clock = new InstantClock();
  const ctx = {
    sites: new Sites(clock),
    fetcher: createFetcher(clock, { bypassSsrf: true }),
    budget: new Budget({ max_requests: 100, max_bytes: 10_000_000, max_seconds: 600 }, clock),
    abort: new AbortController(),
  };
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
      const r = await politeFetch(ctx, `${server.base}/${dir}/robots.txt`, CRAWL, {
        offSite: 'follow',
      });
      if (!('fetch' in r)) throw new Error('not requested');
      const reading = readRobots(r.fetch);
      expect(reading.state).toBe('rules');
      if (reading.state !== 'rules') return;
      expect(oursAllow(reading.rules, '/private/1')).toBe(false);
      expect(oursAllow(reading.rules, '/public')).toBe(true);
    },
  );
});
