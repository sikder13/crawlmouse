/**
 * Starting the Agency trial (CC-29 D3), after the route has established the signed-in person and
 * that V2_BILLING is on. In order:
 * 1. a strict body: `{consent, agencyName, site, interval}`, consent the literal `true` (`'true'` from
 *    a form, which posts strings);
 * 2. a per-person limit;
 * 3. the first client site admitted by `admittedHost`, so a private or reserved host is refused;
 * 4. `start_agency_trial_account` creates the second account with this person as owner and stores the
 *    site, or returns the one an earlier submit made, or answers `trial_used`, which is a 409;
 * 5. a Checkout this account opened within CHECKOUT_REUSE_MS, for the interval this submit asks, is
 *    returned again, not opened twice; one opened for the other interval is not, since the consent
 *    names the interval;
 * 6. otherwise CC-03's `agencyTrial` opens one, and its URL, the time and the interval are stored on
 *    the account.
 * The answer is CC-03's: a 303 to Checkout for a form, `{url}` for JSON, a JSON refusal otherwise.
 */
import { z } from 'zod';
import type { Interval } from '@/lib/billing/catalog';
import { SESSION_LIFETIME_S, type BillingResult } from '@/lib/billing/checkout-v2';
import { readBody, refuse, respond } from '@/lib/billing/request-body';
import type { Admitted } from '@/lib/v2/account/sites';
import type { StoredCheckout } from './checkouts';
import type { CapturePricingEvent } from '@/lib/v2/pricing/events';

/** Submits one person may make in an hour. */
export const AGENCY_TRIAL_PER_USER_PER_HOUR = 10;

/**
 * How long a stored Checkout is handed back. CC-03 opens each session to expire SESSION_LIFETIME_S
 * after the moment it reads before creating it; the time stored here is read before that, so a
 * session younger than this, less one minute, is still open.
 */
export const CHECKOUT_REUSE_MS = (SESSION_LIFETIME_S - 60) * 1000;

export type StartedAccount =
  | { outcome: 'trial_used' }
  | { outcome: 'created' | 'existing'; accountId: string; siteId: string };

export interface AgencyTrialDeps {
  /** Counts one request against `key`'s bucket: AGENCY_TRIAL_PER_USER_PER_HOUR an hour. */
  rateLimit(key: string): Promise<{ allowed: boolean }>;
  admit(site: string): Promise<Admitted>;
  /** `start_agency_trial_account` through the service role. */
  startAccount(userId: string, name: string, host: string): Promise<StartedAccount>;
  /** The Checkout stored on the account, or null. */
  openCheckout(accountId: string): Promise<StoredCheckout | null>;
  storeCheckout(accountId: string, checkout: StoredCheckout): Promise<void>;
  /** CC-03's `agencyTrial` with the deps its own route builds. */
  checkout(input: {
    accountId: string;
    email: string | null;
    interval: Interval;
  }): Promise<BillingResult>;
  capture: CapturePricingEvent;
  /**
   * `first_client_added` for the account (CC-31 D10, ruling Q41): the first site added to an agency
   * account by any path, and this form stores an agency account's first site.
   */
  firstClient(accountId: string): Promise<void>;
  /** Runs work after the response (Next's `after` in the route). */
  defer(work: () => Promise<void>): void;
  now(): Date;
}

export interface Person {
  id: string;
  email: string | null;
}

const bodyFor = (kind: 'form' | 'json') =>
  z.strictObject({
    consent: kind === 'json' ? z.literal(true) : z.literal('true'),
    agencyName: z.string().trim().min(1).max(120),
    site: z.string().max(2048),
    interval: z.enum(['month', 'year']),
  });

export async function startAgencyTrial(
  req: Request,
  person: Person,
  deps: AgencyTrialDeps,
): Promise<Response> {
  const body = await readBody(req);
  const parsed = body && bodyFor(body.kind).safeParse(body.fields);
  if (!body || !parsed?.success) return refuse(400, 'invalid');
  const { agencyName, site, interval } = parsed.data;

  const rl = await deps.rateLimit(`agency-trial:user:${person.id}`);
  if (!rl.allowed) return refuse(429, 'rate_limited');

  const admitted = await deps.admit(site);
  if (!admitted.ok) return refuse(400, admitted.code);

  const started = await deps.startAccount(person.id, agencyName, admitted.host);
  if (started.outcome === 'trial_used') {
    return refuse(409, 'trial_used', { reason: 'the person has used their agency trial' });
  }
  const { accountId } = started;
  deps.defer(() => deps.capture('plan_chosen', accountId, { plan: 'agency', interval }));
  // `created`: the account was made now, with this site its first. `existing` is the account of an
  // earlier submit, whose first site that submit stored and reported.
  if (started.outcome === 'created') deps.defer(() => deps.firstClient(accountId));

  const open = await deps.openCheckout(accountId);
  const at = deps.now();
  if (
    open !== null &&
    open.interval === interval &&
    at.getTime() - open.at.getTime() < CHECKOUT_REUSE_MS
  ) {
    return respond(body.kind, open.url);
  }

  const result = await deps.checkout({ accountId, email: person.email, interval });
  if (!result.ok) return refuse(result.status, result.error, result.detail);
  await deps.storeCheckout(accountId, { url: result.url, at, interval });
  deps.defer(() =>
    deps.capture('trial_started', accountId, {
      kind: 'agency',
      variant: 'card_required',
      stage: 'checkout_opened',
    }),
  );
  return respond(body.kind, result.url);
}
