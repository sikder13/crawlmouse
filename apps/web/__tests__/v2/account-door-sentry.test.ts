/**
 * The sign-in path sends Sentry no token and no claim capability (SECURITY-DESIGN §9.2). Sentry's
 * Next.js integration copies each request cookie onto sampled spans and filters a cookie only when
 * its name holds one of its snippets; this runs that very function, from the installed SDK, over the
 * door's cookie names, and then the scrubber over an event shaped as Sentry builds one.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { COOKIES } from '../../lib/auth/constants';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubDoorSecrets } from '../../lib/auth/sentry-scrub';

const HERE = dirname(fileURLToPath(import.meta.url));

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

  it('drops every cookie key, and keeps everything else', () => {
    const out = scrubDoorSecrets({
      ...event(),
      request: { ...event().request, headers: { cookie: 'a=1', accept: 'text/html' } },
    }) as ReturnType<typeof event> & { request: { headers: Record<string, string> } };
    expect(out.request.query_string).toBe('token_hash=[Filtered]&type=magiclink');
    expect('cookies' in out.request).toBe(false);
    expect(out.request.headers).toEqual({ accept: 'text/html' });
    expect(out.spans[0]!.data['http.method']).toBe('GET');
  });

  it.each([
    [`/x?next=%2Flogin%2Fverify%3Ftoken_hash%3D${TOKEN}%26type%3Dmagiclink`],
    [`/login/verify?TOKEN_HASH=${TOKEN}`],
    [`a=1;token_hash=${TOKEN}`],
    [`/login/verify?code=${TOKEN}#x`],
  ])('replaces the token in %s', (url) => {
    expect(scrubDoorSecrets({ url }).url).not.toContain('LEAKCANARY');
  });

  it('a parameter that only ends in the name is not a secret (error_code=, zip_code=)', () => {
    expect(scrubDoorSecrets({ q: '/x?error_code=otp_expired&zip_code=1' }).q).toBe(
      '/x?error_code=otp_expired&zip_code=1',
    );
  });
});

/** What reached Sentry's transport, from a fresh process running _lib/sentry-capture.ts. */
function capturedWith(mode: 'full' | 'integration' | 'scrubber' | 'none'): string {
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  return execFileSync(process.execPath, [tsx, join(HERE, '_lib', 'sentry-capture.ts'), mode], {
    encoding: 'utf8',
    timeout: 60_000,
  });
}

/** Cookie values whose names Sentry's span filter catches (`auth`, `sb-`). */
const NAMED_COOKIES = ['LEAKCANARY', 'DEVICECANARY', 'SIGNUPCANARY', 'FORCANARY', 'SESSIONCANARY'];
/** What only the scrubber removes: v1's cookie and the claim id in span attributes, the URL token, a breadcrumb's filter. */
const SCRUBBER_ONLY = ['ANONCANARY', '11111111-1111', 'URLCANARY', 'CHECKIDCANARY'];

describe('the server SDK sends no door secret in an event or a transaction', () => {
  it.each([
    [
      'with sentryServerOptions, as sentry.server.config.ts runs',
      'full',
      [...NAMED_COOKIES, ...SCRUBBER_ONLY],
    ],
    ['with the request-data integration alone: no named cookie', 'integration', NAMED_COOKIES],
    ['with the scrubber alone: nothing', 'scrubber', [...NAMED_COOKIES, ...SCRUBBER_ONLY]],
  ] as const)(
    '%s',
    (_, mode, absent) => {
      const out = capturedWith(mode);
      // Both a message and a transaction reached the transport: an empty or broken run cannot pass,
      // and the scrubber did not throw inside the SDK (which would replace the transaction).
      expect(out).toContain('auth.landing-failed');
      expect(out).toContain('"type":"transaction"');
      expect(out).toContain('door-transaction');
      expect(out).not.toContain('Cannot set property');
      for (const canary of absent) expect(out, canary).not.toContain(canary);
    },
    60_000,
  );

  it('without either, the SDK does send them (the test sees what it guards against)', () => {
    const out = capturedWith('none');
    for (const canary of [...NAMED_COOKIES, 'ANONCANARY', 'URLCANARY', 'CHECKIDCANARY']) {
      expect(out, canary).toContain(canary);
    }
  }, 60_000);
});

describe('scrubDoorSecrets leaves the SDK’s own objects alone', () => {
  it('does not walk sdkProcessingMetadata or a class instance, so a getter-only property cannot throw', () => {
    class Live {
      get $() {
        return 'state';
      }
    }
    const live = new Live();
    const event = {
      sdkProcessingMetadata: { capturedSpanScope: live },
      other: live,
      url: '?code=x',
    };
    expect(() => scrubDoorSecrets(event)).not.toThrow();
    expect(event.sdkProcessingMetadata.capturedSpanScope).toBe(live);
    expect(event.url).toBe('?code=[Filtered]');
  });

  it('drops span cookie-header attributes and PostgREST filter values', () => {
    const out = scrubDoorSecrets({
      data: {
        'http.request.header.cookie.crawlmouse_anon': 'x',
        'http.query': '?id=eq.abc&select=id',
      },
    });
    expect(out.data).toEqual({ 'http.query': '?id=eq.[Filtered]&select=id' });
  });
});

describe('scrubDoorSecrets, inside strings', () => {
  it('replaces a post_login_next value in a cookie header string', () => {
    const out = scrubDoorSecrets({
      request: { headers: { 'x-raw': 'post_login_next=/api/checks/abc/claim; x=1' } },
    });
    expect(out.request.headers['x-raw']).toBe('post_login_next=[Filtered]; x=1');
  });
});
