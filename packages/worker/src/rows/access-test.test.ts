import { describe, expect, it } from 'vitest';
import { CRAWLERS } from '../identities.js';
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
