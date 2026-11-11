/**
 * The first-login hook (CC-25): on the sign-in that confirms a person's email, decide the no-card Pro
 * trial and start it; and, at any sign-in with room, attach the site the Sign-up form named.
 *
 * First login is the verify that confirmed the email (D5 as amended on 2026-11-05): Supabase sets
 * `email_confirmed_at` and `last_sign_in_at` in that one verify, and a later sign-in moves only
 * `last_sign_in_at`. Both are read from the verify's own response. This depends on Supabase Auth's
 * auto-confirm being off, which `scripts/supabase/auth-config.ts --read` asserts.
 *
 * The trial, in order:
 * 1. the account must be Free with no trial used, and the pepper set;
 * 2. the ledger hashes are computed here (the pepper never reaches the database);
 * 3. `next()` computes `trial_started {variant: 'no_card'}` from the account as read;
 * 4. `start_trial_with_ledger` (migration 006c) does the rest in one transaction: it locks the
 *    account and the hashes, applies the ledger rule, and either refuses or applies the transition
 *    and writes the ledger rows. Its version check refuses a stale read (`not_first`);
 * 5. when it answers `started`, the transition's effects are dispatched (CC-03 D9b): `trial.started`,
 *    which starts the trial's own clock, and `entitlement.changed`. A failed dispatch is reported as
 *    `trial-dispatch-failed` and the sign-in goes on; the hourly sweep still expires the trial once
 *    it has ended. Nothing is dispatched for any other outcome.
 * A decision the function cannot make is reported as `auth.trial-decision-failed` and leaves the
 * account Free; it is not retried (docs/specs/v2/06c-trial-function.md, known gaps).
 * The named site (at any sign-in) follows; its `(account_id, host)` unique index makes a second
 * insert a no-op. With `firstAudit` given (door-deps.ts, under V2_CHECKS_PUBLIC with V2_PIPELINE;
 * CC-22b D7), a site this call attached gets its first audit requested; a failure there is reported
 * as `first-audit-failed` and the sign-in goes on with the site attached.
 */
import { planEffects, type PlannedEffect } from '../billing/effects';
import { next, type EntitlementSnapshot, type Transition } from '../billing/state-machine';
import { toTransitionParams, type EntitlementStore } from '../billing/state-machine-apply';
import { effectiveTier } from '../entitlement-v2';
import type { FunnelEvent } from '../analytics-events';
import { TimeZoneSchema } from '@crawlmouse/types/v2';
import type { DoorStore, FirstAudit, LedgerHash, MemberAccount, Report } from './door-store';
import { hashLedgerValue, ledgerValues } from './ledger';
import { scheduleFor } from './schedule';
import { siteLimitAt } from './site-limit';
import { hostFromSiteInput } from './site-host';
import { MalformedTrialDecisionError, type TrialDecision } from './trial-decision';
import { trialVariantFor } from './trial-variant';

/** The confirmation and the sign-in are one verify when they are this close. */
export const FIRST_LOGIN_TOLERANCE_MS = 5000;

export function isFirstLogin(
  emailConfirmedAt: string | null,
  lastSignInAt: string | null,
): boolean {
  if (!emailConfirmedAt || !lastSignInAt) return false;
  const confirmed = Date.parse(emailConfirmedAt);
  const signedIn = Date.parse(lastSignInAt);
  if (Number.isNaN(confirmed) || Number.isNaN(signedIn)) return false;
  return Math.abs(signedIn - confirmed) <= FIRST_LOGIN_TOLERANCE_MS;
}

/** What the Sign-up form asked for, as carried in the `cm_auth_signup` cookie: re-validated here. */
export interface SignupIntent {
  site?: string;
  tz?: string;
}

export interface FirstLoginInput {
  userId: string;
  email: string;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
  /** The `cm_auth_device` cookie of the browser that opened the link. */
  device: string | null;
  /** `getClientIp`'s value; 'unknown' when the platform gave none. */
  ip: string;
  signup: SignupIntent | null;
}

export interface FirstLoginDeps {
  store: DoorStore;
  /** Reads the account's entitlement snapshot and version for `next()`. */
  entitlement: EntitlementStore;
  /** The SSRF guard for a named site (`admitSiteHost`). */
  admit: (host: string) => Promise<boolean>;
  report: Report;
  /** `pepperFrom(process.env)`: null fails closed. */
  pepper: string | null;
  now: () => Date;
  /**
   * Sends a started trial's planned effects: `billingDispatcher(process.env)`, a no-op with
   * V2_BILLING unset.
   */
  dispatch: (planned: readonly PlannedEffect[]) => Promise<void>;
  /** Requests the first audit of a site this hook attached; absent, none is requested. */
  firstAudit?: FirstAudit;
}

/** What the hook decided about the trial, each with the case that produces it. The spec lists them. */
export const TRIAL_OUTCOMES = {
  started:
    'the no-card Pro trial started; three ledger rows, or fewer when the device or IP is unknown or the device is not sent',
  denied: 'a ledger row refused it; the account stays Free',
  not_first: 'not the verify that confirmed the email, or another run won the version check',
  not_eligible:
    'the account is not Free, or has used its trial, or the state machine gives it none',
  failed:
    'the trial function errored, timed out on a lock, or answered something unreadable: Free, `auth.trial-decision-failed`, not retried',
  no_account: 'the user has no v2 account (from before migration 001): nothing is done',
  no_pepper:
    'TRIAL_LEDGER_PEPPER is missing or short: no ledger read or write, Free, a Sentry signal',
} as const;

export type TrialOutcome = keyof typeof TRIAL_OUTCOMES;

export interface DoorEvent {
  name: Extract<FunnelEvent, 'trial_started' | 'site_added'>;
  props: Record<string, string | number>;
}

export interface FirstLoginResult {
  trial: TrialOutcome;
  siteId: string | null;
  events: DoorEvent[];
}

export async function runFirstLogin(
  deps: FirstLoginDeps,
  input: FirstLoginInput,
): Promise<FirstLoginResult> {
  const account = await deps.store.loadMember(input.userId);
  if (account === null) return { trial: 'no_account', siteId: null, events: [] };
  const events: DoorEvent[] = [];

  let trial: TrialOutcome = 'not_first';
  let zone = account.timezone;
  if (isFirstLogin(input.emailConfirmedAt, input.lastSignInAt)) {
    const asked = validZone(input.signup?.tz);
    if (asked !== null) {
      await deps.store.setTimezone(account.accountId, asked);
      zone = asked;
    }
    const decided = await decideTrial(deps, input, account);
    trial = decided.outcome;
    if (trial === 'started') {
      events.push({ name: 'trial_started', props: { kind: 'pro', variant: decided.variant } });
    }
  }

  // A site named on Sign-up is attached at any sign-in that has room: an existing account uses the
  // same form ("Already have an account? Use the same form").
  const added = await attachNamedSite(deps, input, account, zone);
  if (added !== null) {
    events.push({ name: 'site_added', props: { n: added.n } });
    await requestFirstAudit(deps, account, added, input.userId);
  }
  return { trial, siteId: added?.siteId ?? null, events };
}

/** The attached site's first audit; a failure is reported, not raised. */
async function requestFirstAudit(
  deps: FirstLoginDeps,
  account: MemberAccount,
  site: { siteId: string; host: string },
  userId: string,
): Promise<void> {
  if (!deps.firstAudit) return;
  try {
    await deps.firstAudit({ siteId: site.siteId, host: site.host, userId });
  } catch {
    deps.report('first-audit-failed', { accountId: account.accountId, siteId: site.siteId });
  }
}

function validZone(zone: string | undefined): string | null {
  return typeof zone === 'string' && TimeZoneSchema.safeParse(zone).success ? zone : null;
}

export async function decideTrial(
  deps: FirstLoginDeps,
  input: FirstLoginInput,
  account: MemberAccount,
): Promise<{ outcome: TrialOutcome; variant: 'no_card' }> {
  const variant = trialVariantFor(input.email);
  if (account.state !== 'free' || account.trialUsedAt !== null)
    return { outcome: 'not_eligible', variant };
  if (deps.pepper === null) {
    deps.report('trial-ledger-no-pepper', { accountId: account.accountId });
    return { outcome: 'no_pepper', variant };
  }
  const pepper = deps.pepper;
  const hashes: LedgerHash[] = ledgerValues(input).map((v) => ({
    kind: v.kind,
    value_hash: hashLedgerValue(pepper, v.kind, v.value),
  }));

  const stored = await deps.entitlement.load(account.accountId);
  if (stored === null) return { outcome: 'not_eligible', variant };
  const now = deps.now();
  const planned = next(stored.snapshot, { type: 'trial_started', at: now, variant });
  if (planned.outcome !== 'applied') return { outcome: 'not_eligible', variant };
  const transition = {
    event: 'trial_started' as const,
    ...toTransitionParams(account.accountId, stored.version, planned.state, now),
  };

  let decision: TrialDecision;
  try {
    decision = await deps.store.startTrial(account.accountId, hashes, transition);
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (code === '40001') return { outcome: 'not_first', variant };
    deps.report('trial-decision-failed', {
      accountId: account.accountId,
      ...failureOf(e, code),
    });
    return { outcome: 'failed', variant };
  }
  if (decision.outcome === 'refused') {
    console.info(JSON.stringify({ event: 'trial.fingerprint_hit', kinds: decision.hits }));
    return { outcome: 'denied', variant };
  }
  if (decision.outcome === 'started') {
    await dispatchTrialEffects(deps, account.accountId, stored.snapshot, planned);
  }
  return { outcome: decision.outcome, variant };
}

/** The started trial's effects, through the dispatcher; a failure is reported, not raised. */
async function dispatchTrialEffects(
  deps: FirstLoginDeps,
  accountId: string,
  before: EntitlementSnapshot,
  started: Extract<Transition, { outcome: 'applied' }>,
): Promise<void> {
  try {
    await deps.dispatch(
      planEffects(started.effects, {
        accountId,
        source: 'trial-start',
        before,
        after: started.state,
      }),
    );
  } catch {
    deps.report('trial-dispatch-failed', { accountId });
  }
}

/** Why the trial function gave no decision: a lock timeout, an unreadable answer, or an error. */
function failureOf(e: unknown, code: unknown): Record<string, string> {
  if (e instanceof MalformedTrialDecisionError) return { reason: 'malformed_result' };
  if (code === '55P03') return { reason: 'lock_timeout' };
  return typeof code === 'string' ? { reason: 'rpc_error', code } : { reason: 'rpc_error' };
}

/** The named site, its host, and its number among the account's kept sites (`site_added {n}`). */
async function attachNamedSite(
  deps: FirstLoginDeps,
  input: FirstLoginInput,
  account: MemberAccount,
  zone: string,
): Promise<{ siteId: string; host: string; n: number } | null> {
  const raw = input.signup?.site;
  if (typeof raw !== 'string') return null;
  const host = hostFromSiteInput(raw);
  if (host === null) return null;
  if (!(await deps.admit(host))) {
    deps.report('first-site-refused', { accountId: account.accountId });
    return null;
  }
  // Read again: the trial may have just changed the tier and the site limit.
  const now = deps.now();
  const current = (await deps.store.loadMember(input.userId)) ?? account;
  const tier = effectiveTier(current, now);
  const kept = await deps.store.countActiveSites(account.accountId);
  if (kept >= siteLimitAt(current, now)) return null;
  const inserted = await deps.store.insertSite({
    accountId: account.accountId,
    ownerSeatId: account.ownerSeatId,
    host,
    schedule: scheduleFor(tier, kept === 0, now, zone),
  });
  return inserted === 'exists' ? null : { siteId: inserted.siteId, host, n: kept + 1 };
}
