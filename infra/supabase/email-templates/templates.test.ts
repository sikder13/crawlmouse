import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// vitest injects __dirname in test files; this pins reads to the template dir.
const read = (f: string): string => readFileSync(join(__dirname, f), 'utf8');

const magicLink = read('magic-link.html');
const signup = read('signup.html');

// The exact verify-route contract. These strings MUST stay in lock-step with
// apps/web/app/login/verify/route.ts's verifyOtp({ token_hash, type }) allow-list
// (ALLOWED_OTP_TYPES = magiclink, signup, email). The token_hash path is the
// cross-device-robust one; the default {{ .ConfirmationURL }} PKCE link is NOT.
const MAGIC_LINK_HREF = '{{ .SiteURL }}/login/verify?token_hash={{ .TokenHash }}&type=magiclink';
const SIGNUP_QUERY = 'token_hash={{ .TokenHash }}&type=signup';
const SIGNUP_HREF = '{{ .SiteURL }}/login/verify?token_hash={{ .TokenHash }}&type=signup';

describe('magic-link.html', () => {
  it('uses the token_hash verify link with type=magiclink (cross-device-robust)', () => {
    expect(magicLink).toContain(MAGIC_LINK_HREF);
  });

  it('does NOT use the default PKCE {{ .ConfirmationURL }} link', () => {
    // The default Supabase link emits a ?code= PKCE URL and breaks cross-device sign-in.
    expect(magicLink).not.toContain('{{ .ConfirmationURL }}');
  });

  it('has no <style> block (email clients strip them; inline CSS only)', () => {
    expect(magicLink).not.toMatch(/<style[\s>]/i);
  });

  it('includes {{ .SiteURL }} and a plaintext fallback URL', () => {
    expect(magicLink).toContain('{{ .SiteURL }}');
    // The full URL appears at least twice (button href + plaintext fallback).
    const occurrences = magicLink.split(MAGIC_LINK_HREF).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

describe('signup.html', () => {
  it('uses the token_hash verify query with type=signup', () => {
    expect(signup).toContain(SIGNUP_QUERY);
  });

  it('uses the full token_hash verify link with type=signup', () => {
    expect(signup).toContain(SIGNUP_HREF);
  });

  it('does NOT use the default PKCE {{ .ConfirmationURL }} link', () => {
    expect(signup).not.toContain('{{ .ConfirmationURL }}');
  });

  it('has no <style> block (email clients strip them; inline CSS only)', () => {
    expect(signup).not.toMatch(/<style[\s>]/i);
  });

  it('includes {{ .SiteURL }} and a plaintext fallback URL', () => {
    expect(signup).toContain('{{ .SiteURL }}');
    const occurrences = signup.split(SIGNUP_HREF).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});
