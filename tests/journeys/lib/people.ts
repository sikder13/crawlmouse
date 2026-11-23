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

/** This host cannot be added now: it is at the product's hourly limit, or the account already keeps it. */
export class HostUnavailable extends Error {
  constructor(host: string, status: number) {
    super(`could not add ${host}: ${status}`);
  }
}

// A host takes five checks an hour. Steps that need no fix start on the sites the fix steps do not use, so that one
// full run of J4 stays inside that limit.
const LAB_CLIENTS = [
  'client-5',
  'client-6',
  'demo-1',
  'demo-2',
  'trial-client-1',
  'client-1',
  'client-2',
].map((h) => `${h}.lab.crawlmouse.com`);

/**
 * Keeps one of the lab's sites on `who`'s account, in the listed order, moving on only when a host
 * is at its hourly limit or this account already keeps it, so that a second run within the hour does not fail on the
 * limit. Any other failure throws.
 */
export async function keptLabSite(
  who: Person,
  hosts: readonly string[] = LAB_CLIENTS,
): Promise<{ site: string; host: string }> {
  for (const host of hosts) {
    try {
      return { site: await keptSite(who, host), host };
    } catch (e) {
      if (!(e instanceof HostUnavailable)) throw e;
    }
  }
  throw new Error('every lab host in the list is at its hourly limit or already kept');
}

/**
 * Keeps a lab site on `who`'s account through the dashboard's route, and returns its id. Until staging has
 * a queue the route commits the site and its send then throws (F-168), so a 500 is accepted here and the
 * row is what is read.
 */
export async function keptSite(who: Person, host: string): Promise<string> {
  assertCheckableSite(host);
  await who.page.goto('/dashboard');
  const { status, code } = await who.page.evaluate(async (url) => {
    const r = await fetch('/api/sites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const answer = (await r.json().catch(() => null)) as { code?: unknown } | null;
    return { status: r.status, code: answer?.code };
  }, `https://${host}`);
  // Only the per-host limit, or a host this account already keeps, moves on to another host. Any other answer is a
  // failure of its own.
  if (status === 429 && code === 'domain_capped') throw new HostUnavailable(host, status);
  if (status === 409 && code === 'site_exists') throw new HostUnavailable(host, status);
  if (status !== 201 && status !== 500) {
    throw new Error(`could not add ${host}: ${status} ${String(code)}`);
  }
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

/** The lab sites whose crawl produces fixes, so a step about a fix has a real one. */
const LAB_WITH_FIXES = ['client-1', 'client-2', 'client-3', 'client-4', 'demo-3', 'healthy'].map(
  (h) => `${h}.lab.crawlmouse.com`,
);

/** A kept site whose first check has really finished, with one of its fixes. */
export async function finishedLabSite(
  who: Person,
): Promise<{ site: string; host: string; check: string; fix: string }> {
  const { site, host } = await keptLabSite(who, LAB_WITH_FIXES);
  const db = stagingAdmin();
  const deadline = Date.now() + 330_000;
  for (;;) {
    const { data, error } = await db
      .from('checks')
      .select('id, status')
      .eq('site_id', site)
      .order('queued_at', { ascending: false })
      .limit(1)
      .single();
    if (error || !data) throw new Error(`no check for ${host}: ${error?.message ?? 'none'}`);
    if (data.status === 'finished' || data.status === 'partial') {
      const fixes = await db.from('site_fixes').select('id').eq('site_id', site).limit(1);
      if (fixes.error || !fixes.data?.[0]) throw new Error(`${host} finished with no fix`);
      return { site, host, check: data.id as string, fix: fixes.data[0].id as string };
    }
    if (data.status === 'failed') throw new Error(`the check of ${host} failed`);
    if (Date.now() > deadline) throw new Error(`the check of ${host} is still ${data.status}`);
    await new Promise((r) => setTimeout(r, 4000));
  }
}

/** A signed-in person whose only seat has been removed: an account with no active v2 seat. */
export async function personWithNoSeat(
  context: BrowserContext,
  baseURL: string,
  journey: string,
  n: number,
): Promise<Person> {
  const who = await person(context, baseURL, journey, n);
  const { error } = await stagingAdmin()
    .from('seats')
    .update({ status: 'removed', removed_at: new Date().toISOString() })
    .eq('user_id', who.userId);
  if (error) throw new Error(`could not remove the seat: ${error.message}`);
  return who;
}

/** A person with a seat of their own who was once a member of `of`, and has been removed from it. */
export async function removedMember(
  context: BrowserContext,
  baseURL: string,
  of: Person,
  journey: string,
  n: number,
): Promise<Person> {
  const who = await person(context, baseURL, journey, n);
  const now = new Date().toISOString();
  const { error } = await stagingAdmin().from('seats').insert({
    account_id: of.accountId,
    user_id: who.userId,
    invited_email: who.email,
    role: 'developer',
    status: 'removed',
    accepted_at: now,
    removed_at: now,
  });
  if (error) throw new Error(`could not add the removed seat: ${error.message}`);
  return who;
}
