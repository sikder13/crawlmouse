/**
 * The sign-in path sends Sentry no token and no claim capability (SECURITY-DESIGN §9.2). Sentry's
 * Next.js integration copies each request cookie onto sampled spans and filters a cookie only when
 * its name holds one of its snippets; this runs that very function, from the installed SDK, over the
 * door's cookie names, and then the scrubber over an event shaped as Sentry builds one.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { COOKIES } from '../../lib/auth/constants';
import { scrubDoorSecrets } from '../../lib/auth/sentry-scrub';

const TOKEN = 'pkce_LEAKCANARY_77';

// The @sentry/core that @sentry/nextjs itself loads: the copy production runs.
const fromNextjs = createRequire(createRequire(import.meta.url).resolve('@sentry/nextjs'));
const { httpHeadersToSpanAttributes } = fromNextjs('@sentry/core') as {
  httpHeadersToSpanAttributes: (h: Record<string, string>, pii: boolean) => Record<string, string>;
};

describe('Sentry span attributes', () => {
  it('filter every door cookie by name, with the repo setting sendDefaultPii=false', () => {
    const door = [COOKIES.otp, COOKIES.signup, COOKIES.device];
    const header = door.map((n) => `${n}=${TOKEN}`).join('; ');
    const attrs = httpHeadersToSpanAttributes({ cookie: header }, false);
    for (const name of door) {
      expect(attrs[`http.request.header.cookie.${name}`], name).toBe('[Filtered]');
    }
    expect(JSON.stringify(attrs)).not.toContain('LEAKCANARY');
  });

  it('do not filter post_login_next by name, which is why the scrubber drops it', () => {
    const attrs = httpHeadersToSpanAttributes(
      { cookie: `${COOKIES.next}=/api/checks/x/claim` },
      false,
    );
    expect(attrs[`http.request.header.cookie.${COOKIES.next}`]).toBe('/api/checks/x/claim');
    expect(JSON.stringify(scrubDoorSecrets({ spans: [{ data: attrs }] }))).not.toContain('claim');
  });
});

describe('scrubDoorSecrets', () => {
  const event = () => ({
    transaction: `GET /login/verify?token_hash=${TOKEN}&type=magiclink`,
    request: {
      url: `https://crawlmouse.com/login/verify?token_hash=${TOKEN}&type=magiclink`,
      query_string: `token_hash=${TOKEN}&type=magiclink`,
      cookies: { post_login_next: '/api/checks/abc/claim?then=/dashboard', other: 'kept' },
    },
    contexts: { trace: { data: { 'http.target': `/login/verify?code=${TOKEN}` } } },
    spans: [
      {
        data: {
          'http.url': `https://crawlmouse.com/login/verify?type=magiclink&token_hash=${TOKEN}`,
          'http.request.header.cookie.post_login_next': '/api/checks/abc/claim',
          'http.method': 'GET',
        },
      },
    ],
  });

  it('removes the token from every URL and the claim target from every key, at any depth', () => {
    const out = JSON.stringify(scrubDoorSecrets(event()));
    expect(out).not.toContain('LEAKCANARY');
    expect(out).not.toContain('post_login_next');
    expect(out).not.toContain('/api/checks/abc');
  });

  it('keeps everything else', () => {
    const out = scrubDoorSecrets(event());
    expect(out.request.query_string).toBe('token_hash=[Filtered]&type=magiclink');
    expect(out.request.cookies).toEqual({ other: 'kept' });
    expect(out.spans[0]!.data['http.method']).toBe('GET');
  });

  it('a parameter that only ends in the name is not a secret (error_code=, zip_code=)', () => {
    expect(scrubDoorSecrets({ q: '/x?error_code=otp_expired&zip_code=1' }).q).toBe(
      '/x?error_code=otp_expired&zip_code=1',
    );
  });
});
