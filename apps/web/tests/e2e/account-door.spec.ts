/**
 * The account door end to end, against a Vercel preview deployment with V2_ACCOUNT_DOOR=1.
 * OWNER-RUN, never in CI: previews use the production database, so this signs up real auth users,
 * and it needs the service-role key. Skipped unless E2E_BASE_URL is set.
 *
 * Reads from scripts/.env.local: E2E_BASE_URL (the preview URL), VERCEL_AUTOMATION_BYPASS_SECRET
 * (the project's protection bypass), NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and
 * optionally E2E_EMAIL_DOMAIN (default crawlmouse.com). The preview must run Turnstile with
 * Cloudflare's always-pass test keys, or with no Turnstile secret (previews are not enforced then).
 *
 *   cd apps/web && pnpm exec playwright test tests/e2e/account-door.spec.ts --workers=1
 *
 * The sign-in link is read through the Supabase admin API (`generateLink`), since main has no
 * test-mail route; generating it replaces the emailed one, as a resend would.
 *
 * What it deletes afterwards, for each address it made: the `sites`, `seats` and `accounts` rows of
 * its account, its `public.users` row, then the auth user. Nothing cascades from auth.users, so
 * each is deleted by id. The `trial_ledger` rows stay, by design (their account_id becomes null):
 * a ledger forgets nothing, which is why every run uses a new local part.
 */
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function scriptsEnv(): Record<string, string> {
  try {
    const text = readFileSync(new URL('../../../../scripts/.env.local', import.meta.url), 'utf8');
    return Object.fromEntries(
      text
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    );
  } catch {
    return {};
  }
}

const env = scriptsEnv();
const BASE = env.E2E_BASE_URL?.replace(/\/+$/, '');
const DOMAIN = env.E2E_EMAIL_DOMAIN || 'crawlmouse.com';
const SITE = 'example.com';

test.skip(!BASE, 'E2E_BASE_URL is not set in scripts/.env.local: owner-run against a preview');
test.describe.configure({ mode: 'serial' });

let admin: SupabaseClient;
const made: string[] = [];

test.beforeAll(() => {
  admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
});

const BYPASS: Record<string, string> = env.VERCEL_AUTOMATION_BYPASS_SECRET
  ? {
      'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET,
      'x-vercel-set-bypass-cookie': 'true',
    }
  : {};
test.use({ extraHTTPHeaders: BYPASS });

async function userIdOf(email: string): Promise<string> {
  const { data, error } = await admin.from('users').select('id').eq('email', email).single();
  if (error) throw new Error(`users read: ${error.message}`);
  return (data as { id: string }).id;
}

async function accountOf(email: string) {
  const id = await userIdOf(email);
  const { data: u } = await admin.from('users').select('default_account_id').eq('id', id).single();
  const accountId = (u as { default_account_id: string }).default_account_id;
  const { data: a } = await admin.from('accounts').select('id, state').eq('id', accountId).single();
  return a as { id: string; state: string };
}

async function signUp(page: Page, email: string) {
  await page.goto(`${BASE}/signup`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/First site to audit/).fill(SITE);
  await page.getByRole('button', { name: 'Send my sign-in link' }).click();
  await page.waitForURL(/\/check-email\?kind=named-site&site=example\.com$/);
  made.push(email);
}

async function linkFor(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`generateLink: ${error.message}`);
  return `${BASE}/login/verify?token_hash=${data.properties.hashed_token}&type=magiclink`;
}

async function openLink(page: Page, url: string) {
  await page.goto(url);
  await page.waitForURL(/\/login\/verify\/continue/);
  expect(page.url()).not.toContain('token_hash');
  await page.getByRole('button', { name: 'Continue' }).click();
}

test.afterAll(async () => {
  for (const email of made) {
    const { data } = await admin.from('users').select('id, default_account_id').eq('email', email);
    for (const u of (data ?? []) as { id: string; default_account_id: string | null }[]) {
      if (u.default_account_id) {
        await admin.from('sites').delete().eq('account_id', u.default_account_id);
        await admin.from('seats').delete().eq('account_id', u.default_account_id);
        await admin.from('users').update({ default_account_id: null }).eq('id', u.id);
        await admin.from('accounts').delete().eq('id', u.default_account_id);
      }
      await admin.from('users').delete().eq('id', u.id);
      await admin.auth.admin.deleteUser(u.id);
    }
  }
});

const email = `cc25-e2e-${Date.now().toString(36)}@${DOMAIN}`;

test('sign-up with a first site → Continue → dashboard: a Pro trial, one site, three ledger rows', async ({
  page,
}) => {
  await signUp(page, email);
  const url = await linkFor(email);
  await openLink(page, url);
  await page.waitForURL(/\/dashboard/);

  const account = await accountOf(email);
  expect(account.state).toBe('pro_trial');
  const { data: sites } = await admin.from('sites').select('host').eq('account_id', account.id);
  expect(sites).toEqual([{ host: SITE }]);
  const { count } = await admin
    .from('trial_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', account.id);
  expect(count).toBe(3);

  // A second click of the same link lands on the expired state.
  await openLink(page, url);
  await expect(
    page.getByRole('heading', { name: 'This link has been used or has expired.' }),
  ).toBeVisible();
});

test('a second sign-up with the same email, after the first account is gone, starts Free', async ({
  browser,
}) => {
  // Remove the first account as afterAll would; its ledger rows stay and now refuse the trial.
  const first = await accountOf(email);
  const id = await userIdOf(email);
  await admin.from('sites').delete().eq('account_id', first.id);
  await admin.from('seats').delete().eq('account_id', first.id);
  await admin.from('users').update({ default_account_id: null }).eq('id', id);
  await admin.from('accounts').delete().eq('id', first.id);
  await admin.from('users').delete().eq('id', id);
  await admin.auth.admin.deleteUser(id);

  const page = await (await browser.newContext({ extraHTTPHeaders: BYPASS })).newPage();
  await signUp(page, email);
  await openLink(page, await linkFor(email));
  await page.waitForURL(/\/dashboard/);
  expect((await accountOf(email)).state).toBe('free');
});
