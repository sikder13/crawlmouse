import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AccountViewer } from './account/viewer-read';
import { hasSessionCookie, sessionHeaderFromCookies, sessionHeaderOf } from './session-header';

// RC-02, F-008: one header answer per person, for every kind of viewer.

const viewer = (theme: AccountViewer['seat']['theme']) =>
  ({ kind: 'viewer', viewer: { seat: { theme } } as AccountViewer }) as const;

describe('sessionHeaderOf', () => {
  it('a signed-out visitor is signed out', () => {
    expect(sessionHeaderOf({ kind: 'signed_out' })).toEqual({ kind: 'signed_out' });
  });

  it('a person in an account is signed in, with their seat’s theme', () => {
    for (const theme of ['system', 'light', 'dark'] as const) {
      expect(sessionHeaderOf(viewer(theme))).toEqual({ kind: 'signed_in', theme });
    }
  });

  it('a person with no account, or with several and none chosen, is still signed in', () => {
    expect(sessionHeaderOf({ kind: 'no_account', userId: 'u' })).toEqual({
      kind: 'signed_in',
      theme: null,
    });
    expect(sessionHeaderOf({ kind: 'ambiguous', userId: 'u' })).toEqual({
      kind: 'signed_in',
      theme: null,
    });
  });

  it('carries nothing about the person but the theme', () => {
    const full = {
      kind: 'viewer',
      viewer: {
        userId: 'u-1',
        email: 'someone@example.com',
        seat: { id: 's-1', role: 'owner', theme: 'dark' },
        account: { id: 'a-1', name: 'Acme' },
      },
    } as unknown as Parameters<typeof sessionHeaderOf>[0];
    const text = JSON.stringify(sessionHeaderOf(full));
    for (const secret of ['u-1', 'someone@example.com', 's-1', 'a-1', 'Acme']) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('hasSessionCookie', () => {
  const REF = 'ezspnfeyzwsisymytssm';

  it('finds the session cookie, whole or split into chunks', () => {
    expect(hasSessionCookie(`sb-${REF}-auth-token=base64-eyJ`)).toBe(true);
    expect(hasSessionCookie(`cm_consent=1; sb-${REF}-auth-token.0=base64-a; x=1`)).toBe(true);
    expect(hasSessionCookie(`sb-${REF}-auth-token.1=b`)).toBe(true);
  });

  it('ignores the PKCE verifier, an empty value, look-alikes and no cookies', () => {
    expect(hasSessionCookie(`sb-${REF}-auth-token-code-verifier=abc`)).toBe(false);
    expect(hasSessionCookie(`sb-${REF}-auth-token=`)).toBe(false);
    expect(hasSessionCookie(`xsb-${REF}-auth-token=1`)).toBe(false);
    expect(hasSessionCookie(`sb-${REF}-auth-tokens=1`)).toBe(false);
    expect(hasSessionCookie('ph_phc_abc_posthog=%7B%7D; cm_account=a')).toBe(false);
    expect(hasSessionCookie('')).toBe(false);
    expect(hasSessionCookie(null)).toBe(false);
    expect(hasSessionCookie(undefined)).toBe(false);
  });

  it('is true exactly when some pair is a non-empty session cookie, over generated jars', () => {
    const name = fc.oneof(
      fc.constantFrom(
        `sb-${REF}-auth-token`,
        `sb-${REF}-auth-token.0`,
        `sb-${REF}-auth-token.12`,
        `sb-${REF}-auth-token-code-verifier`,
        'cm_consent',
        'cm_account',
        'ph_phc_x_posthog',
      ),
      fc.stringMatching(/^[a-z_][a-z0-9_.-]{0,12}$/),
    );
    const value = fc.oneof(fc.constant(''), fc.stringMatching(/^[A-Za-z0-9%._-]{1,10}$/));
    fc.assert(
      fc.property(fc.array(fc.tuple(name, value), { maxLength: 6 }), (pairs) => {
        const jar = pairs.map(([n, v]) => `${n}=${v}`).join('; ');
        const expected = pairs.some(
          ([n, v]) => v !== '' && /^sb-[a-z0-9]+-auth-token(?:\.\d+)?$/.test(n),
        );
        expect(hasSessionCookie(jar)).toBe(expected);
        expect(sessionHeaderFromCookies(jar)).toEqual(
          expected ? { kind: 'signed_in', theme: null } : { kind: 'signed_out' },
        );
      }),
    );
  });
});
