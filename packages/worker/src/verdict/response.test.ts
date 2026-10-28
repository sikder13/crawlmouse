import { describe, expect, it } from 'vitest';
import { outcome } from '../test-support/outcome.js';
import { readResponse } from './response.js';

const CF_CHALLENGE_BODY =
  '<html><head><title>Just a moment...</title></head><script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script></html>';

describe('readResponse: challenges, headers first', () => {
  it('a cf-mitigated: challenge header is a challenge whatever the status', () => {
    for (const status of [200, 403, 503]) {
      const r = readResponse(
        outcome({ status, headers: { 'cf-mitigated': 'challenge' }, body: '' }),
      );
      expect(r).toMatchObject({ class: 'challenged', challenge: 'mitigation_header' });
    }
  });

  it('x-vercel-mitigated: challenge is a challenge', () => {
    const r = readResponse(
      outcome({ status: 403, headers: { 'x-vercel-mitigated': 'challenge' } }),
    );
    expect(r.challenge).toBe('mitigation_header');
  });

  it('a redirect that lands on a challenge endpoint is a challenge', () => {
    const r = readResponse(
      outcome({
        status: 200,
        hops: [
          {
            from: 'https://www.example.com/page',
            status: 302,
            location: 'https://www.example.com/.well-known/sgcaptcha/?r=%2Fpage',
          },
        ],
        finalUrl: 'https://www.example.com/.well-known/sgcaptcha/?r=%2Fpage',
      }),
    );
    expect(r).toMatchObject({ class: 'challenged', challenge: 'challenge_redirect' });
  });

  it('reads the body only as a tiebreak on a 403 or 503 the headers did not explain', () => {
    expect(readResponse(outcome({ status: 403, body: CF_CHALLENGE_BODY }))).toMatchObject({
      class: 'challenged',
      challenge: 'body_signature',
    });
    expect(readResponse(outcome({ status: 503, body: CF_CHALLENGE_BODY })).class).toBe(
      'challenged',
    );
  });

  it('a 200 page whose text mentions a challenge was served', () => {
    expect(readResponse(outcome({ status: 200, body: CF_CHALLENGE_BODY })).class).toBe('served');
  });

  it('a plain 403 with no signature is a refusal, not a challenge', () => {
    expect(readResponse(outcome({ status: 403, body: 'Forbidden' }))).toMatchObject({
      class: 'refused',
      challenge: null,
    });
  });

  it('a body signature past the tiebreak window is not read', () => {
    const body = 'x'.repeat(9000) + CF_CHALLENGE_BODY;
    expect(readResponse(outcome({ status: 403, body })).class).toBe('refused');
  });
});

describe('readResponse: redirects', () => {
  it('a redirect to another registrable domain is redirected_away', () => {
    const r = readResponse(outcome({ finalUrl: 'https://queue.example-waitroom.com/' }));
    expect(r.class).toBe('redirected_away');
  });

  it('a redirect between www and the apex, or to a subdomain, stays on the site', () => {
    expect(
      readResponse(outcome({ url: 'https://example.com/', finalUrl: 'https://www.example.com/' }))
        .class,
    ).toBe('served');
    expect(readResponse(outcome({ finalUrl: 'https://shop.example.com/' })).class).toBe('served');
  });
});

describe('readResponse: status', () => {
  it.each([
    [200, 'served'],
    [204, 'served'],
    [402, 'payment'],
    [429, 'rate_limited'],
    [404, 'gone'],
    [410, 'gone'],
    [401, 'refused'],
    [403, 'refused'],
    [451, 'refused'],
    [999, 'refused'],
    [500, 'error'],
    [503, 'error'],
    [304, 'error'],
  ] as const)('%i -> %s', (status, cls) => {
    expect(readResponse(outcome({ status, body: '' })).class).toBe(cls);
  });

  it('a failed fetch is an error', () => {
    expect(readResponse(outcome({ status: null, finalUrl: null, error: 'timeout' })).class).toBe(
      'error',
    );
  });

  it("flags Cloudflare's 1020 firewall code on a refusal", () => {
    const r = readResponse(
      outcome({ status: 403, body: 'error code: 1020', headers: { server: 'cloudflare' } }),
    );
    expect(r).toMatchObject({ class: 'refused', cloudflare1020: true });
    expect(readResponse(outcome({ status: 403, body: 'Forbidden' })).cloudflare1020).toBe(false);
  });
});
