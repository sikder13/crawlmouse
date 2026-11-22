/**
 * Test accounts on STAGING ONLY: create a confirmed user and sign them in the way the product's own
 * magic link does (`/login/verify?token_hash=…&type=magiclink`), without sending mail.
 *
 * The admin client is built only when the environment names staging's project exactly
 * (`stagingAdminRefusal`); production's project is refused by name. Keys come from
 * ~/.crawlmouse-staging.env, loaded by the caller; nothing here prints them. Addresses are on
 * lab.crawlmouse.com, so no person's address is ever used and no mail can reach anyone.
 */
// pnpm installs supabase-js for apps/web only; import it through apps/web, as pw.ts does Playwright.
import {
  createClient,
  type SupabaseClient,
} from '../../../apps/web/node_modules/@supabase/supabase-js/dist/index.mjs';
import { PRODUCTION_REF } from './target';
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

let admin: SupabaseClient | null = null;
export function stagingAdmin(env: Env = process.env): SupabaseClient {
  const refused = stagingAdminRefusal(env);
  if (refused) throw new Error(`refusing the admin client: ${refused}`);
  admin ??= createClient(STAGING_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

/** A fresh address for one journey's person, on our own lab domain: `qa+j1-<stamp>-<n>@lab.crawlmouse.com`. */
export function testAddress(journey: string, n = 1, now = Date.now()): string {
  if (!/^j[0-4]$/.test(journey)) throw new Error(`not a journey: ${journey}`);
  return `qa+${journey}-${now.toString(36)}-${n}@lab.crawlmouse.com`;
}

export function isTestAddress(address: string): boolean {
  return /^qa\+j[0-4]-[a-z0-9]+-\d+@lab\.crawlmouse\.com$/.test(address);
}

/** Creates a confirmed user for a test address. Returns the user id. */
export async function createTestUser(address: string): Promise<string> {
  if (!isTestAddress(address))
    throw new Error('createTestUser: only a journey test address is allowed');
  const { data, error } = await stagingAdmin().auth.admin.createUser({
    email: address,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user.id;
}

/** Signs `page` in as `address` through the product's own verify route. The link is never logged. */
export async function signIn(page: Page, address: string): Promise<void> {
  if (!isTestAddress(address)) throw new Error('signIn: only a journey test address is allowed');
  const { data, error } = await stagingAdmin().auth.admin.generateLink({
    type: 'magiclink',
    email: address,
  });
  if (error) throw error;
  const hash = encodeURIComponent(data.properties.hashed_token);
  await page.goto(`/login/verify?token_hash=${hash}&type=magiclink`);
}
