import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessTest } from '@crawlmouse/types/v2';
import { createFetcher } from '../fetch/fetcher.js';
import { CANARY, CONTROL, CRAWLERS, CRAWL_USER_AGENT, TAG } from '../identities.js';
import { Sites } from '../politeness/sites.js';
import { InstantClock } from '../test-support/clock.js';
import {
  SAMPLE_PAGES,
  SITES,
  SITE_EXPECTATIONS,
  pagePath,
  siteServer,
  whoSent,
  type Site,
} from '../test-support/discriminators.js';
import { startServer, type FixtureServer } from '../test-support/http.js';
import type { BatchRequest } from './request.js';
import { runBatch, type BatchResult } from './run.js';
import { RobotsCache } from './site-rules.js';

const CHECK = '00000000-0000-4000-8000-0000000000c1';
const SITE_ID = '00000000-0000-4000-8000-0000000000a1';

function accessRequest(base: string): BatchRequest {
  return {
    kind: 'access',
    check_id: CHECK,
    site_id: SITE_ID,
    batch: 1,
    nonce: 'nonce-nonce-nonce-1',
    jwt: 'unused-by-run-batch',
    budget: { max_requests: 1000, max_bytes: 50_000_000, max_seconds: 1800 },
    pages: Array.from({ length: SAMPLE_PAGES }, (_, i) => ({
      url: `${base}${pagePath(i)}`,
      template_key: '/p/{n}',
    })),
  };
}

const counts = (rows: AccessTest[], token: string) => {
  const out: Record<string, number> = {};
  for (const r of rows.filter((x) => x.ua === token)) out[r.verdict] = (out[r.verdict] ?? 0) + 1;
  return out;
};

const servers = new Map<Site, FixtureServer>();
const results = new Map<Site, BatchResult & { kind: 'access' }>();

beforeAll(async () => {
  for (const site of SITES) {
    const server = await siteServer(site);
    servers.set(site, server);
    const clock = new InstantClock();
    const result = await runBatch(accessRequest(server.base), {
      clock,
      sites: new Sites(clock),
      fetcher: createFetcher(clock, { bypassSsrf: true }),
      robotsCache: new RobotsCache(clock),
    });
    if (result.kind !== 'access') throw new Error('expected an access result');
    results.set(site, result);
  }
});
afterAll(async () => {
  for (const s of servers.values()) await s.close();
});

describe('the five discriminator sites, from their recorded POC shapes', () => {
  it.each(SITES)('%s: every crawler gets exactly the expected verdicts over 20 pages', (site) => {
    const rows = results.get(site)!.access_tests;
    for (const c of CRAWLERS)
      expect({ [c.token!]: counts(rows, c.token!) }).toEqual({
        [c.token!]: SITE_EXPECTATIONS[site][c.token!],
      });
  });

  it("nike.com: the canary's own row says what it got, with no crawler named", () => {
    const canaryRows = results
      .get('nike.com')!
      .access_tests.filter((r) => r.identity_sent === CANARY.userAgent);
    expect(canaryRows).toHaveLength(SAMPLE_PAGES);
    for (const r of canaryRows)
      expect(r).toMatchObject({ ua: null, verdict: 'refused_unverified', raw_status: 403 });
  });

  it('nike.com: a refusal is a user-agent rule because another crawler was served on the page, and names it', () => {
    const row = results.get('nike.com')!.access_tests.find((r) => r.ua === 'GPTBot')!;
    expect(row.verdict).toBe('blocked_by_ua_rule');
    // The first identity served in request order: the registry's order, then the canary.
    expect(row.witness).toEqual({ role: 'crawler', ua: 'Claude-SearchBot' });
    expect(row.limitations.join(' ')).toContain(
      // Hedged: a caveat follows (the witness went as its bare token).
      'Claude-SearchBot was served on this page from the same address, so this refusal is likely aimed at the user agent rather than at an unverified address.',
    );
    expect(row.limitations.join(' ')).toContain(
      'Claude-SearchBot and ClaudeBot were served on this page.',
    );
    // Anthropic publishes no user agent for it, so the witness went as its bare token, and says so.
    expect(row.limitations.join(' ')).toContain(
      "Claude-SearchBot was sent as its bare token, because Anthropic publishes no user agent for it, so a rule keyed on the operator's full user agent may not have taken it for a crawler.",
    );
  });

  it("en.wikipedia.org: a witness sent with its operator's user agent carries no bare-token caveat", () => {
    const row = results.get('en.wikipedia.org')!.access_tests.find((r) => r.ua === 'ClaudeBot')!;
    expect(row.limitations.join(' ')).not.toContain('bare token');
  });

  it('en.wikipedia.org: ClaudeBot is witnessed by the first crawler served, OAI-SearchBot', () => {
    const row = results.get('en.wikipedia.org')!.access_tests.find((r) => r.ua === 'ClaudeBot')!;
    expect(row).toMatchObject({
      verdict: 'blocked_by_ua_rule',
      witness: { role: 'crawler', ua: 'OAI-SearchBot' },
    });
  });

  it('css-tricks.com: every refusal is a user-agent rule because the canary was served on every page', () => {
    const rows = results.get('css-tricks.com')!.access_tests;
    const canaryRows = rows.filter((r) => r.identity_sent === CANARY.userAgent);
    expect(canaryRows).toHaveLength(SAMPLE_PAGES);
    expect(canaryRows.every((r) => r.verdict === 'allowed' && r.ua === null)).toBe(true);
    const row = rows.find((r) => r.ua === 'GPTBot')!;
    expect(row.witness).toEqual({ role: 'canary', ua: 'Googlebot' });
    expect(row.limitations.join(' ')).toContain(
      'The tagged Googlebot request was served on this page from the same address, so this refusal is aimed at the user agent, not at an unverified address.',
    );
    expect(row.limitations.join(' ')).toContain('No other tested crawler was served on this page.');
  });

  it('every limitation fits its 500-byte budget whole, so none is cut', () => {
    for (const site of SITES)
      for (const r of results.get(site)!.access_tests)
        for (const l of r.limitations) expect(Buffer.byteLength(l), l).toBeLessThan(500);
  });

  it('a witness is recorded on exactly the blocked_by_ua_rule rows', () => {
    for (const site of SITES)
      for (const r of results.get(site)!.access_tests)
        expect(r.witness !== null).toBe(r.verdict === 'blocked_by_ua_rule' && r.ua !== null);
  });

  it('cnn.com: robots.txt disallows the six, so none is requested and each verdict is declared', () => {
    const sent = servers
      .get('cnn.com')!
      .requests.map((r) => whoSent(String(r.headers['user-agent'])));
    for (const c of CRAWLERS) expect(sent).not.toContain(c.token);
    expect(sent).not.toContain('canary');
    const rows = results.get('cnn.com')!.access_tests.filter((r) => r.ua !== null);
    expect(
      rows.every((r) => r.evidence_class === 'declared' && r.cause === 'robots_txt_disallow'),
    ).toBe(true);
  });

  it('neilpatel.com: each challenged row names what identified the challenge', () => {
    const challenged = results
      .get('neilpatel.com')!
      .access_tests.filter((r) => r.verdict === 'challenged_ua');
    expect(challenged.length).toBeGreaterThan(0);
    for (const r of challenged) {
      expect(r.limitations).toContain('Recognised as a challenge by the cf-mitigated header.');
    }
  });

  it('neilpatel.com: no refusal, so the canary is never requested', () => {
    const sent = servers
      .get('neilpatel.com')!
      .requests.map((r) => whoSent(String(r.headers['user-agent'])));
    expect(sent).not.toContain('canary');
  });

  it('every page gets one control row, tagged with no crawler and no Crawlmouse tag', () => {
    for (const site of SITES) {
      const control = results
        .get(site)!
        .access_tests.filter((r) => r.identity_sent === CONTROL.userAgent);
      expect(control).toHaveLength(SAMPLE_PAGES);
      expect(control.every((r) => r.ua === null && !r.identity_sent.includes(TAG))).toBe(true);
    }
  });

  it('every row has at least one limitation, and off Fly says so: no region, other egress', () => {
    for (const site of SITES) {
      for (const r of results.get(site)!.access_tests) {
        expect(r).toMatchObject({ source_ip_class: 'other_egress', fly_region: null });
        expect(r.limitations.length).toBeGreaterThan(0);
      }
    }
  });

  it('each row names its identity: role, and whether the request sent carried our tag', () => {
    for (const site of SITES) {
      for (const r of results.get(site)!.access_tests) {
        // A method row is told by the request it shows; a crawler row can show another's (the
        // control's, when it was blocked), so it is told by naming a crawler.
        const role =
          r.ua !== null
            ? 'crawler'
            : r.identity_sent === CONTROL.userAgent
              ? 'control'
              : r.identity_sent === CANARY.userAgent
                ? 'canary'
                : 'unknown';
        expect(r.identity_role).toBe(role);
        expect(r.tagged).toBe(r.identity_sent.includes('Crawlmouse/2.0'));
        if (role === 'control') expect(r.tagged).toBe(false);
      }
    }
  });

  it('cnn.com: a disallowed row shows the robots.txt read, sent as our crawler and tagged', () => {
    const rows = results.get('cnn.com')!.access_tests.filter((r) => r.ua !== null);
    for (const r of rows)
      expect(r).toMatchObject({
        identity_role: 'crawler',
        identity_sent: CRAWL_USER_AGENT,
        tagged: true,
      });
    expect(results.get('cnn.com')!.robots.map((o) => o.identity_sent)).toEqual([CRAWL_USER_AGENT]);
  });

  it('a complete batch is not partial', () => {
    for (const site of SITES) {
      const r = results.get(site)!;
      expect(r.partial).toBeNull();
      expect(r.coverage).toEqual({ urls_requested: SAMPLE_PAGES, urls_complete: SAMPLE_PAGES });
    }
  });
});

describe('the witness rule: the browser control is not a witness', () => {
  let server: FixtureServer;
  let result: BatchResult & { kind: 'access' };
  beforeAll(async () => {
    // robots.txt allows everything; the browser control is served; every crawler and the canary get a
    // plain 403, so nothing we sent that claims to be a crawler was served.
    server = await startServer((req, res) => {
      if (req.url === '/robots.txt') return res.end('User-agent: *\nAllow: /\n');
      const who = whoSent(String(req.headers['user-agent'] ?? ''));
      if (who === 'control' || who === 'crawl') {
        res.setHeader('content-type', 'text/html');
        return res.end('<html><body><p>one two three four five</p></body></html>');
      }
      res.statusCode = 403;
      res.setHeader('content-type', 'text/plain');
      res.end('Forbidden');
    });
    const clock = new InstantClock();
    const one = accessRequest(server.base);
    if (one.kind !== 'access') throw new Error('expected an access request');
    const r = await runBatch(
      { ...one, pages: [{ url: `${server.base}/`, template_key: '/' }] },
      {
        clock,
        sites: new Sites(clock),
        fetcher: createFetcher(clock, { bypassSsrf: true }),
        robotsCache: new RobotsCache(clock),
      },
    );
    if (r.kind !== 'access') throw new Error('expected an access result');
    result = r;
  });
  afterAll(() => server.close());

  it('every crawler is refused_unverified with no witness, though the control was served', () => {
    const rows = result.access_tests.filter((r) => r.ua !== null);
    expect(rows).toHaveLength(CRAWLERS.length);
    for (const r of rows) expect(r).toMatchObject({ verdict: 'refused_unverified', witness: null });
    expect(rows[0]!.limitations.join(' ')).toContain(
      'No other tested crawler was served on this page, and the tagged Googlebot request was refused, so this refusal cannot be told apart from IP verification.',
    );
  });
});

describe('the witness rule: a witness requested before the refusal is said to be', () => {
  let server: FixtureServer;
  let result: BatchResult & { kind: 'access' };
  beforeAll(async () => {
    // The first two crawlers in request order are served, every later one and the canary refused: the
    // shape a limit on requests per address gives.
    const firstTwo = CRAWLERS.slice(0, 2).map((c) => c.token!);
    server = await startServer((req, res) => {
      if (req.url === '/robots.txt') return res.end('User-agent: *\nAllow: /\n');
      const who = whoSent(String(req.headers['user-agent'] ?? ''));
      if (who === 'control' || who === 'crawl' || firstTwo.includes(who)) {
        res.setHeader('content-type', 'text/html');
        return res.end('<html><body><p>one two three four five</p></body></html>');
      }
      res.statusCode = 403;
      res.end('Forbidden');
    });
    const clock = new InstantClock();
    const one = accessRequest(server.base);
    if (one.kind !== 'access') throw new Error('expected an access request');
    const r = await runBatch(
      { ...one, pages: [{ url: `${server.base}/`, template_key: '/' }] },
      {
        clock,
        sites: new Sites(clock),
        fetcher: createFetcher(clock, { bypassSsrf: true }),
        robotsCache: new RobotsCache(clock),
      },
    );
    if (r.kind !== 'access') throw new Error('expected an access result');
    result = r;
  });
  afterAll(() => server.close());

  it('a refusal after every identity served carries the request-limit caveat, and says so only then', () => {
    const late = result.access_tests.find((r) => r.ua === CRAWLERS.at(-1)!.token)!;
    expect(late.verdict).toBe('blocked_by_ua_rule');
    expect(late.limitations.join(' ')).toContain(
      'Every identity served on this page was requested before this one, so a limit on requests per address would look the same.',
    );
  });
});

describe('the witness rule: no request-limit caveat when a witness came after', () => {
  it('nike.com: a refusal with a crawler served after it carries none', async () => {
    const row = results.get('nike.com')!.access_tests.find((r) => r.ua === 'OAI-SearchBot')!;
    expect(row.verdict).toBe('blocked_by_ua_rule');
    expect(row.limitations.join(' ')).not.toContain('a limit on requests per address');
  });
});

describe('the witness rule: a crawler served is the witness before the canary', () => {
  it('records the first crawler served, though the canary was served too', async () => {
    const server = await startServer((req, res) => {
      if (req.url === '/robots.txt') return res.end('User-agent: *\nAllow: /\n');
      if (whoSent(String(req.headers['user-agent'] ?? '')) === 'GPTBot') {
        res.statusCode = 403;
        return res.end('Forbidden');
      }
      res.setHeader('content-type', 'text/html');
      res.end('<html><body><p>one two three four five</p></body></html>');
    });
    try {
      const clock = new InstantClock();
      const one = accessRequest(server.base);
      if (one.kind !== 'access') throw new Error('expected an access request');
      const r = await runBatch(
        { ...one, pages: [{ url: `${server.base}/`, template_key: '/' }] },
        {
          clock,
          sites: new Sites(clock),
          fetcher: createFetcher(clock, { bypassSsrf: true }),
          robotsCache: new RobotsCache(clock),
        },
      );
      if (r.kind !== 'access') throw new Error('expected an access result');
      expect(r.access_tests.find((t) => t.identity_role === 'canary')!.verdict).toBe('allowed');
      expect(r.access_tests.find((t) => t.ua === 'GPTBot')).toMatchObject({
        verdict: 'blocked_by_ua_rule',
        witness: { role: 'crawler', ua: CRAWLERS[0]!.token },
      });
    } finally {
      await server.close();
    }
  });
});
