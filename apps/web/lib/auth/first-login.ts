/**
 * The first-login hook (CC-25): on the sign-in that confirms a person's email, decide the no-card Pro
 * trial by the ledger rule and start it; and, at any sign-in with room, attach the site the Sign-up
 * form named.
 *
 * First login is the verify that confirmed the email (D5 as amended on 2026-11-05): Supabase sets
 * `email_confirmed_at` and `last_sign_in_at` in that one verify, and a later sign-in moves only
 * `last_sign_in_at`. Both are read from the verify's own response. This depends on Supabase Auth's
 * auto-confirm being off, which `scripts/supabase/auth-config.ts --read` asserts.
 *
 * Order, and what makes it once:
 * 1. a slot on the email and the device hash (`gridSerialize` in stores.ts): of two first logins
 *    sharing either within half a slot window of each other, the second is refused, failing safe;
 *    one later than that finds the first's ledger rows once the first has written them;
 * 2. the ledger lookup;
 * 3. `applyEntitlementTransition(trial_started)`: the RPC reads the account `for update` and
 *    refuses a stale version, and `next()` refuses a second trial;
 * 4. only when the transition was applied: the ledger rows;
 * 5. the named site (at any sign-in), whose `(account_id, host)` unique index makes a second insert
 *    a no-op.
 * A crash between 3 and 4 leaves a trial with no ledger rows; that write is reported. CC-06c closes
 * it with one SQL function (docs/specs/v2/25-account-door.md, follow-ups).
 */
import {
  applyEntitlementTransition,
  EntitlementConflictError,
  type EntitlementStore,
} from '../billing/state-machine-apply';
import { effectiveTier } from '../entitlement-v2';
import type { FunnelEvent } from '../analytics-events';
import { TimeZoneSchema } from '@crawlmouse/types/v2';
import type { DoorStore, LedgerHash, MemberAccount, Report, Serialize } from './door-store';
import { hashLedgerValue, ledgerDecision, ledgerValues, oldestRelevant, slotKey } from './ledger';
import { scheduleFor } from './schedule';
import { siteLimitAt } from './site-limit';
import { hostFromSiteInput } from './site-host';
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
  entitlement: EntitlementStore;
  serialize: Serialize;
  /** The SSRF guard for a named site (`admitSiteHost`). */
  admit: (host: string) => Promise<boolean>;
  report: Report;
  /** `pepperFrom(process.env)`: null fails closed. */
  pepper: string | null;
  now: () => Date;
}

/** What the hook decided about the trial, each with the case that produces it. The spec lists them. */
export const TRIAL_OUTCOMES = {
  started:
    'the no-card Pro trial started; three ledger rows, or fewer when the device or IP is unknown',
  denied: 'a ledger row refused it; the account stays Free',
  busy: 'another first login holds a slot on the same email or device; refused, failing safe',
  not_first: 'not the verify that confirmed the email, or another run won the version check',
  not_eligible: 'the account is not Free, or has used its trial',
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
  if (added !== null) events.push({ name: 'site_added', props: { n: added.n } });
  return { trial, siteId: added?.siteId ?? null, events };
}

function validZone(zone: string | undefined): string | null {
  return typeof zone === 'string' && TimeZoneSchema.safeParse(zone).success ? zone : null;
}

async function decideTrial(
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

  for (const h of hashes) {
    if (h.kind === 'ip24') continue; // a network is shared by strangers; it never holds a slot
    if (!(await deps.serialize(slotKey(pepper, h.kind, h.value_hash))))
      return { outcome: 'busy', variant };
  }

  const now = deps.now();
  const decision = ledgerDecision(await deps.store.priorLedger(hashes, oldestRelevant(now)), now);
  if (decision.deny) {
    console.info(JSON.stringify({ event: 'trial.fingerprint_hit', kinds: decision.hits }));
    return { outcome: 'denied', variant };
  }

  let applied;
  try {
    applied = await applyEntitlementTransition(deps.entitlement, account.accountId, {
      type: 'trial_started',
      at: now,
      variant,
    });
  } catch (e) {
    if (e instanceof EntitlementConflictError) return { outcome: 'not_first', variant };
    throw e;
  }
  if (applied.transition.outcome !== 'applied') return { outcome: 'not_eligible', variant };

  try {
    await deps.store.insertLedger(account.accountId, hashes);
  } catch {
    deps.report('trial-ledger-write-failed', { accountId: account.accountId });
  }
  return { outcome: 'started', variant };
}

/** The named site, and its number among the account's kept sites (`site_added {n}`). */
async function attachNamedSite(
  deps: FirstLoginDeps,
  input: FirstLoginInput,
  account: MemberAccount,
  zone: string,
): Promise<{ siteId: string; n: number } | null> {
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
  return inserted === 'exists' ? null : { siteId: inserted.siteId, n: kept + 1 };
}
