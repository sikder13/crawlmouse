import type { BrowserContext, Page } from '../pw';
import { createTestUser, signIn, stagingAdmin, testAddress } from './accounts';
import { bypassCookies } from './protection';
import { assertCheckableSite } from './sites';

/** A signed-in test person on staging, in a browser context of their own. */
export interface Person {
  context: BrowserContext;
  page: Page;
  email: string;
  userId: string;
  accountId: string;
}

/** A fresh browser context on the deployment: signed out, carrying only the bypass cookie if there is one. */
export async function freshContext(from: BrowserContext, baseURL: string): Promise<BrowserContext> {
  const context = await from.browser()!.newContext({ baseURL });
  const cookies = await bypassCookies(new URL(baseURL).origin, process.env);
  if (cookies.length > 0) await context.addCookies(cookies);
  return context;
}

/** Creates a test user and signs them in, in `context`. */
export async function person(
  context: BrowserContext,
  baseURL: string,
  journey: string,
  n: number,
): Promise<Person> {
  const page = await context.newPage();
  const email = testAddress(journey, n);
  const userId = await createTestUser(email);
  await signIn(page, baseURL, email);
  const { data, error } = await stagingAdmin()
    .from('seats')
    .select('account_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();
  if (error || !data)
    throw new Error(`no active seat for the test user: ${error?.message ?? 'none'}`);
  return { context, page, email, userId, accountId: data.account_id as string };
}

/**
 * Keeps a lab site on `who`'s account through the dashboard's route, and returns its id. Until staging has
 * a queue the route commits the site and its send then throws (F-168), so a 500 is accepted here and the
 * row is what is read.
 */
export async function keptSite(who: Person, host: string): Promise<string> {
  assertCheckableSite(host);
  await who.page.goto('/dashboard');
  const status = await who.page.evaluate(async (url) => {
    const r = await fetch('/api/sites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    return r.status;
  }, `https://${host}`);
  if (status !== 201 && status !== 500) throw new Error(`could not add ${host}: ${status}`);
  const { data } = await stagingAdmin()
    .from('sites')
    .select('id')
    .eq('account_id', who.accountId)
    .eq('host', host)
    .is('removed_at', null)
    .maybeSingle();
  if (!data) throw new Error(`no kept site for ${host}`);
  return data.id as string;
}
