/**
 * Test accounts on STAGING ONLY: create a confirmed user and sign them in through the product's own
 * magic-link door (`/login/verify`, then Continue), without sending mail.
 *
 * The admin client is built only when the environment names staging's project
 * (`stagingAdminRefusal`); production's project is refused by name. Keys come from
 * ~/.crawlmouse-staging.env, loaded by the caller. Addresses are on lab.crawlmouse.com, which has no
 * MX record (`dig +short MX lab.crawlmouse.com` prints nothing), and sign-in here sends no mail.
 */
// pnpm installs supabase-js for apps/web only; import it through apps/web, as pw.ts does Playwright.
import {
  createClient,
  type SupabaseClient,
} from '../../../apps/web/node_modules/@supabase/supabase-js/dist/index.mjs';
import { databaseRefusal, PRODUCTION_REF, writeRefusal } from './target';
import type { Page } from '../pw';

export const STAGING_REF = 'qfgkrnnjuiasahspavbc';
export const STAGING_SUPABASE_URL = `https://${STAGING_REF}.supabase.co`;

type Env = Readonly<Record<string, string | undefined>>;

/** null when the environment names staging's project and holds a key; otherwise why not. */
export function stagingAdminRefusal(env: Env): string | null {
  const url = (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  if (url.includes(PRODUCTION_REF)) return "SUPABASE_URL names production's project";
  if (url !== STAGING_SUPABASE_URL) return `SUPABASE_URL is not ${STAGING_SUPABASE_URL}`;
  if (env.STAGING_PROJECT_REF !== STAGING_REF) return `STAGING_PROJECT_REF is not ${STAGING_REF}`;
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return 'SUPABASE_SERVICE_ROLE_KEY is not set';
  return null;
}

export function stagingAdmin(env: Env = process.env): SupabaseClient {
  const refused = stagingAdminRefusal(env);
  if (refused) throw new Error(`refusing the admin client: ${refused}`);
  return createClient(STAGING_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A fresh address for one journey's person, on our own lab domain: `qa+j1-<stamp>-<n>@lab.crawlmouse.com`. */
export function testAddress(journey: string, n = 1, now = Date.now()): string {
  if (!/^j[0-4]$/.test(journey)) throw new Error(`not a journey: ${journey}`);
  return `qa+${journey}-${now.toString(36)}-${n}@lab.crawlmouse.com`;
}

export function isTestAddress(address: string): boolean {
  return /^qa\+j[0-4]-[a-z0-9]+-\d+@lab\.crawlmouse\.com$/.test(address);
}

/** The part of the admin API these helpers use, so the guards can be tested without a project. */
export interface AdminAuth {
  auth: {
    admin: {
      createUser(a: { email: string; email_confirm: boolean }): Promise<{
        data: { user: { id: string } | null };
        error: Error | null;
      }>;
      generateLink(a: { type: 'magiclink'; email: string }): Promise<{
        data: { properties: { hashed_token: string } | null };
        error: Error | null;
      }>;
    };
  };
}

/** Creates a confirmed user for a test address. Returns the user id. */
export async function createTestUser(
  address: string,
  admin: () => AdminAuth = () => stagingAdmin() as unknown as AdminAuth,
): Promise<string> {
  if (!isTestAddress(address))
    throw new Error('createTestUser: only a journey test address is allowed');
  const { data, error } = await admin().auth.admin.createUser({
    email: address,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createTestUser failed: ${error?.message ?? 'no user'}`);
  return data.user.id;
}

/**
 * null when `baseURL` may receive a staging sign-in token: the write guard's host and flag rules, then
 * the deployment's own proof of its database. A staging token never goes to any other deployment.
 */
export function signInRefusal(
  baseURL: string,
  headers: Readonly<Record<string, string>>,
  env: Env = process.env,
): string | null {
  return writeRefusal({ ...env, JOURNEY_BASE_URL: baseURL }) ?? databaseRefusal(headers);
}

/**
 * Signs `page` in as `address` through the product's own door: the link (GET stores the token and goes to
 * Continue), then Continue's button (POST verifies), then the screen naming the account. Throws unless
 * that screen names `address`. Errors carry no link: Playwright's own goto error quotes the URL.
 */
export async function signIn(
  page: Page,
  baseURL: string,
  address: string,
  admin: () => AdminAuth = () => stagingAdmin() as unknown as AdminAuth,
): Promise<void> {
  if (!isTestAddress(address)) throw new Error('signIn: only a journey test address is allowed');
  const probe = await page.request.get(new URL('/', baseURL).href, { maxRedirects: 0 });
  const refused = signInRefusal(baseURL, probe.headers());
  if (refused) throw new Error(`signIn: ${refused}`);
  const { data, error } = await admin().auth.admin.generateLink({
    type: 'magiclink',
    email: address,
  });
  if (error || !data.properties) throw new Error('signIn: no link was generated');
  const hash = encodeURIComponent(data.properties.hashed_token);
  try {
    await page.goto(new URL(`/login/verify?token_hash=${hash}&type=magiclink`, baseURL).href);
  } catch {
    throw new Error('signIn: the sign-in link did not open');
  }
  if (new URL(page.url()).pathname !== '/login/verify/continue') {
    throw new Error(`signIn: the link went to ${new URL(page.url()).pathname}, not Continue`);
  }
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const named = page.getByText(`Signed in as ${address}.`, { exact: true });
  try {
    await named.waitFor({ state: 'visible', timeout: 20_000 });
  } catch {
    throw new Error(`signIn: the Continue screen did not name ${address}`);
  }
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });
}
