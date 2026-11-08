/**
 * The Supabase Auth settings the account door depends on (CC-25 D10), read and applied through the
 * Management API, which has no MCP tool (OPERATING-RULES §7).
 *
 *   SUPABASE_PROJECT_REF=<ref> pnpm exec tsx scripts/supabase/auth-config.ts --read
 *   SUPABASE_PROJECT_REF=<ref> pnpm exec tsx scripts/supabase/auth-config.ts --apply   (owner only)
 *
 * `--read` prints each checked setting with what it should be and exits 1 when any differs or is
 * missing. `--apply` sets `mailer_otp_exp` and `mailer_secure_email_change_enabled`, then reads
 * everything back and exits as `--read` would. The templates, `mailer_autoconfirm` and `site_url`
 * are checked, never written.
 *
 * SUPABASE_ACCESS_TOKEN comes from scripts/.env.local (gitignored). It is sent in one header and
 * never printed: an API error prints its status code only.
 */
import { readFileSync } from 'node:fs';
import { AUTH_LINK_SECONDS } from '../../apps/web/lib/auth/constants';

export const PRODUCTION_SITE_URL = 'https://crawlmouse.com';

/** What the sign-in email must link to: the landing, which renders on GET (D3). */
export const MAGIC_LINK_HREF =
  '{{ .SiteURL }}/login/verify?token_hash={{ .TokenHash }}&type=magiclink';
export const SIGNUP_HREF = '{{ .SiteURL }}/login/verify?token_hash={{ .TokenHash }}&type=signup';

export interface Check {
  field: string;
  expected: string;
  actual: string;
  ok: boolean;
}

type Live = Record<string, unknown>;

const show = (v: unknown) =>
  v === undefined ? '(absent)' : typeof v === 'string' ? v : JSON.stringify(v);

function equals(live: Live, field: string, expected: unknown): Check {
  const actual = live[field];
  return { field, expected: show(expected), actual: show(actual), ok: actual === expected };
}

function contains(live: Live, field: string, needle: string): Check {
  const actual = live[field];
  return {
    field,
    expected: `contains ${needle}`,
    actual:
      typeof actual === 'string'
        ? actual.includes(needle)
          ? 'contains it'
          : 'does not contain it'
        : show(actual),
    ok: typeof actual === 'string' && actual.includes(needle),
  };
}

/**
 * Every setting the door relies on. `mailer_autoconfirm` must be false: the first-login rule reads
 * the verify that confirms the email, and auto-confirm would confirm it at sign-up instead.
 */
export function checkAuthConfig(live: Live): Check[] {
  return [
    equals(live, 'mailer_otp_exp', AUTH_LINK_SECONDS),
    equals(live, 'mailer_secure_email_change_enabled', true),
    equals(live, 'mailer_autoconfirm', false),
    equals(live, 'site_url', PRODUCTION_SITE_URL),
    contains(live, 'mailer_templates_magic_link_content', MAGIC_LINK_HREF),
    contains(live, 'mailer_templates_confirmation_content', SIGNUP_HREF),
  ];
}

/** The body `--apply` sends: the two settings this step owns, nothing else. */
export function applyBody() {
  return { mailer_otp_exp: AUTH_LINK_SECONDS, mailer_secure_email_change_enabled: true };
}

export function report(checks: Check[]): string {
  return checks
    .map(
      (c) =>
        `${c.ok ? 'ok  ' : 'DIFF'}  ${c.field}: ${c.actual}${c.ok ? '' : `  (expected ${c.expected})`}`,
    )
    .join('\n');
}

function token(): string {
  const file = new URL('../.env.local', import.meta.url);
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.trim().startsWith('SUPABASE_ACCESS_TOKEN='));
  const value = line?.slice(line.indexOf('=') + 1).trim() ?? '';
  if (!value) throw new Error('SUPABASE_ACCESS_TOKEN is not set in scripts/.env.local');
  return value;
}

async function call(ref: string, method: 'GET' | 'PATCH', body?: object): Promise<Live> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Management API ${method} config/auth answered ${res.status}`);
  return (await res.json()) as Live;
}

async function main(argv: string[]): Promise<number> {
  const mode = argv.includes('--apply') ? 'apply' : argv.includes('--read') ? 'read' : null;
  const ref = process.env.SUPABASE_PROJECT_REF?.trim();
  if (mode === null || !ref) {
    console.error(
      'usage: SUPABASE_PROJECT_REF=<ref> tsx scripts/supabase/auth-config.ts --read | --apply',
    );
    return 2;
  }
  if (mode === 'apply') await call(ref, 'PATCH', applyBody());
  const checks = checkAuthConfig(await call(ref, 'GET'));
  console.log(
    `project ${ref}, ${mode === 'apply' ? 'after --apply' : '--read'}:\n${report(checks)}`,
  );
  return checks.every((c) => c.ok) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : 'failed');
      process.exit(1);
    },
  );
}
