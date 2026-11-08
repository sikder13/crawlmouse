/**
 * scripts/supabase/auth-config.ts: what `--read` checks and what `--apply` sends. The network half
 * is not exercised here; the owner's `--read` output in the PR is its evidence.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyBody,
  checkAuthConfig,
  MAGIC_LINK_HREF,
  PRODUCTION_SITE_URL,
  report,
  SIGNUP_HREF,
} from '../../../../scripts/supabase/auth-config';
import { AUTH_LINK_MINUTES } from '../../lib/auth/constants';
import { WEB_ROOT } from './_lib/tokens-css';

const GOOD = {
  mailer_otp_exp: 900,
  mailer_secure_email_change_enabled: true,
  mailer_autoconfirm: false,
  site_url: 'https://crawlmouse.com',
  mailer_templates_magic_link_content: `<a href="${MAGIC_LINK_HREF}">Sign in</a>`,
  mailer_templates_confirmation_content: `<a href="${SIGNUP_HREF}">Confirm</a>`,
};

describe('auth-config --read', () => {
  it('passes the settings the door needs', () => {
    expect(checkAuthConfig(GOOD).every((c) => c.ok)).toBe(true);
  });

  it('the expiry it requires is the one the Check-email page states', () => {
    expect(GOOD.mailer_otp_exp).toBe(AUTH_LINK_MINUTES * 60);
  });

  it.each([
    ['mailer_otp_exp', 3600],
    ['mailer_secure_email_change_enabled', false],
    ['mailer_autoconfirm', true],
    ['site_url', 'http://127.0.0.1:3000'],
    ['mailer_templates_magic_link_content', '<a href="{{ .ConfirmationURL }}">Sign in</a>'],
    ['mailer_templates_confirmation_content', '<a href="{{ .ConfirmationURL }}">Confirm</a>'],
  ])('fails when %s is %j', (field, value) => {
    const checks = checkAuthConfig({ ...GOOD, [field]: value });
    expect(checks.filter((c) => !c.ok).map((c) => c.field)).toEqual([field]);
  });

  it('fails on a missing field rather than reading it as fine', () => {
    const rest: Record<string, unknown> = { ...GOOD };
    delete rest.mailer_autoconfirm;
    expect(checkAuthConfig(rest).find((c) => c.field === 'mailer_autoconfirm')).toMatchObject({
      ok: false,
      actual: '(absent)',
    });
  });

  it('checks the templates for the hrefs the repo pins', () => {
    for (const [file, href] of [
      ['magic-link.html', MAGIC_LINK_HREF],
      ['signup.html', SIGNUP_HREF],
    ]) {
      const html = readFileSync(
        join(WEB_ROOT, '..', '..', 'infra', 'supabase', 'email-templates', file!),
        'utf8',
      );
      expect(html).toContain(`href="${href}"`);
    }
  });

  it('prints no template body, only whether it holds the href', () => {
    expect(report(checkAuthConfig(GOOD))).not.toContain('<a ');
    expect(PRODUCTION_SITE_URL).toBe('https://crawlmouse.com');
  });
});

describe('auth-config --apply', () => {
  it('writes the two settings this step owns and nothing else', () => {
    expect(applyBody()).toEqual({ mailer_otp_exp: 900, mailer_secure_email_change_enabled: true });
  });
});
