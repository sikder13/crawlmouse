import { describe, expect, it } from 'vitest';
import { CANARY, CONTROL, CRAWL, CRAWLERS } from '../identities.js';
import { outcome } from '../test-support/outcome.js';
import { accessTestRow, type AccessRowInput } from './access-test.js';

const GPTBOT = CRAWLERS.find((c) => c.token === 'GPTBot')!;
const input = (over: Partial<AccessRowInput> = {}): AccessRowInput => ({
  checkId: '00000000-0000-4000-8000-0000000000c3',
  pageUrl: 'https://www.example.com/page',
  templateKey: '/page',
  ua: 'GPTBot',
  verdict: 'allowed',
  evidence: 'simulated',
  cause: null,
  limitations: ['x'],
  fetch: outcome({ identity: GPTBOT }),
  identity: GPTBOT,
  testedAt: 1_700_000_000_000,
  words: 2,
  ...over,
});

describe('accessTestRow', () => {
  it('records the request line as sent, GET over HTTP/1.1, and none when no request was made', () => {
    expect(accessTestRow(input())).toMatchObject({ method: 'GET', http_version: '1.1' });
    expect(accessTestRow(input({ fetch: null }))).toMatchObject({
      method: null,
      http_version: null,
    });
    // A request that failed before any answer (DNS, the SSRF guard) is not known to have been sent.
    const failed = outcome({ identity: GPTBOT, status: null, error: 'dns_failed' });
    expect(accessTestRow(input({ fetch: failed }))).toMatchObject({
      method: null,
      http_version: null,
    });
  });

  it('records the request as sent: Host first, then the identity headers in order', () => {
    const row = accessTestRow(input());
    expect(row.request_headers.map((h) => h.name)).toEqual([
      'Host',
      'User-Agent',
      'Accept',
      'Accept-Encoding',
      'From',
    ]);
    expect(row.request_headers[0]!.value).toBe('www.example.com');
    expect(row.identity_sent).toBe(GPTBOT.userAgent);
  });

  it('keeps only the response headers that bear on a verdict', () => {
    const row = accessTestRow(
      input({
        fetch: outcome({
          identity: GPTBOT,
          headers: {
            'cf-mitigated': 'challenge',
            'set-cookie': ['a=b'],
            server: 'cloudflare',
            'x-secret': 'y',
          },
        }),
      }),
    );
    expect(row.headers).toEqual([
      { name: 'server', value: 'cloudflare' },
      { name: 'cf-mitigated', value: 'challenge' },
    ]);
  });

  it('cuts the body excerpt to 2,000 bytes', () => {
    const row = accessTestRow(
      input({ fetch: outcome({ identity: GPTBOT, body: 'é'.repeat(5000) }) }),
    );
    expect(Buffer.byteLength(row.body_excerpt!)).toBe(2000);
  });

  it('records a non-standard status as null, and says so', () => {
    const row = accessTestRow(
      input({
        verdict: 'refused_unverified',
        fetch: outcome({ identity: GPTBOT, status: 999, body: '' }),
      }),
    );
    expect(row.raw_status).toBeNull();
    expect(row.limitations).toContain(
      'The server answered with the non-standard status 999, which is not recorded as a status.',
    );
  });

  it('records a redirect to a non-web URL as no final URL', () => {
    const row = accessTestRow(
      input({
        fetch: outcome({
          identity: GPTBOT,
          status: 302,
          finalUrl: 'mailto:x@example.com',
          redirectStop: 'off_site',
          hops: [
            { from: 'https://www.example.com/page', status: 302, location: 'mailto:x@example.com' },
          ],
        }),
      }),
    );
    expect(row.final_url).toBeNull();
  });

  it('refuses to emit a row the contract rejects', () => {
    expect(() => accessTestRow(input({ limitations: [], checkId: 'not-a-uuid' }))).toThrow();
  });
});

describe('accessTestRow: CC-12d identity, vantage and evidence', () => {
  const FLY = { flyRegion: 'iad', sourceIpClass: 'fly_egress', release: '0123456789ab' } as const;

  it('names the row by its identity role, and records whether the request sent was tagged', () => {
    expect(accessTestRow(input())).toMatchObject({ identity_role: 'crawler', tagged: true });
    const control = accessTestRow(
      input({ ua: null, identity: CONTROL, fetch: outcome({ identity: CONTROL }) }),
    );
    expect(control).toMatchObject({ ua: null, identity_role: 'control', tagged: false });
    const canary = accessTestRow(
      input({ ua: null, identity: CANARY, fetch: outcome({ identity: CANARY }) }),
    );
    expect(canary).toMatchObject({ ua: null, identity_role: 'canary', tagged: true });
  });

  it('a crawler row whose evidence is the robots.txt read is tagged as the crawl identity that sent it', () => {
    const row = accessTestRow(
      input({
        verdict: 'disallowed_by_robots',
        evidence: 'declared',
        fetch: outcome({ identity: CRAWL }),
      }),
    );
    expect(row).toMatchObject({
      identity_role: 'crawler',
      identity_sent: CRAWL.userAgent,
      tagged: true,
    });
  });

  it("a crawler row that shows the blocked control's request is not tagged: that request was not", () => {
    // control_blocked: every crawler's row shows the control's challenged request as its evidence.
    const row = accessTestRow(
      input({
        verdict: 'edge_blocks_automation',
        cause: 'automation_challenge',
        fetch: outcome({ identity: CONTROL, status: 403 }),
      }),
    );
    expect(row).toMatchObject({
      ua: 'GPTBot',
      identity_role: 'crawler',
      identity_sent: CONTROL.userAgent,
      tagged: false,
    });
  });

  it('records the vantage it is given: region, network class and release', () => {
    expect(accessTestRow(input({ vantage: FLY }))).toMatchObject({
      fly_region: 'iad',
      source_ip_class: 'fly_egress',
      worker_release: '0123456789ab',
    });
  });

  it('records signing as unsigned and the site verification as not observable', () => {
    expect(accessTestRow(input())).toMatchObject({
      request_signing: 'unsigned',
      signature_verified: 'not_observable',
    });
  });

  it("records the request's timing, and none when no request was made", () => {
    const timing = { dns_ms: 3, connect_ms: 9, ttfb_ms: 40, total_ms: 52 };
    expect(accessTestRow(input({ fetch: outcome({ identity: GPTBOT, timing }) })).timing).toEqual(
      timing,
    );
    expect(accessTestRow(input({ fetch: null })).timing).toBeNull();
  });

  it('records the CDN and proxy markers, bounded like every header value', () => {
    const headers = {
      'x-vercel-id': 'iad1::abc',
      'x-amz-cf-id': 'cf-id',
      via: '1.1 varnish, 1.1 abc.cloudfront.net (CloudFront)',
      'akamai-grn': '0.05313217.1567801841.1457a3',
      'akamai-cache-status': 'Miss from child',
      'x-sucuri-id': '11005',
      'x-sucuri-cache': 'HIT',
      'x-not-evidence': 'dropped',
    };
    const row = accessTestRow(input({ fetch: outcome({ identity: GPTBOT, headers }) }));
    const names = row.headers.map((h) => h.name);
    for (const n of Object.keys(headers).filter((n) => n !== 'x-not-evidence'))
      expect(names).toContain(n);
    expect(names).not.toContain('x-not-evidence');
    const long = accessTestRow(
      input({ fetch: outcome({ identity: GPTBOT, headers: { via: 'v'.repeat(5000) } }) }),
    );
    expect(long.headers.find((h) => h.name === 'via')!.value).toHaveLength(1024);
  });

  it('records the witness it is given on a blocked_by_ua_rule row, and refuses one elsewhere', () => {
    const witness = { role: 'crawler', ua: 'ClaudeBot' } as const;
    expect(accessTestRow(input({ verdict: 'blocked_by_ua_rule', witness })).witness).toEqual(
      witness,
    );
    expect(() => accessTestRow(input({ verdict: 'refused_unverified', witness }))).toThrow();
    expect(() => accessTestRow(input({ verdict: 'blocked_by_ua_rule', witness: null }))).toThrow();
  });
});
