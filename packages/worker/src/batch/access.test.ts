import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessTest } from '@crawlmouse/types/v2';
import { createFetcher } from '../fetch/fetcher.js';
import { CANARY, CONTROL, CRAWLERS, TAG } from '../identities.js';
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
import type { FixtureServer } from '../test-support/http.js';
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

  it('nike.com: a refusal with the canary refused is unverified, and the row names who was served', () => {
    const row = results.get('nike.com')!.access_tests.find((r) => r.ua === 'GPTBot')!;
    expect(row.verdict).toBe('refused_unverified');
    expect(row.limitations.join(' ')).toContain('cannot be told apart from IP verification');
    expect(row.limitations.join(' ')).toContain(
      'Claude-SearchBot and ClaudeBot were served on this page.',
    );
  });

  it('css-tricks.com: every refusal is a user-agent rule because the canary was served on every page', () => {
    const rows = results.get('css-tricks.com')!.access_tests;
    const canaryRows = rows.filter((r) => r.identity_sent === CANARY.userAgent);
    expect(canaryRows).toHaveLength(SAMPLE_PAGES);
    expect(canaryRows.every((r) => r.verdict === 'allowed' && r.ua === null)).toBe(true);
    const row = rows.find((r) => r.ua === 'GPTBot')!;
    expect(row.limitations.join(' ')).toContain(
      'The tagged Googlebot request was served on this page, so the site does not check crawler IP addresses here',
    );
    expect(row.limitations.join(' ')).toContain('No other tested crawler was served on this page.');
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

  it('every row is fly_egress evidence with at least one limitation', () => {
    for (const site of SITES) {
      for (const r of results.get(site)!.access_tests) {
        expect(r.source_ip_class).toBe('fly_egress');
        expect(r.limitations.length).toBeGreaterThan(0);
      }
    }
  });

  it('a complete batch is not partial', () => {
    for (const site of SITES) {
      const r = results.get(site)!;
      expect(r.partial).toBeNull();
      expect(r.coverage).toEqual({ urls_requested: SAMPLE_PAGES, urls_complete: SAMPLE_PAGES });
    }
  });
});
