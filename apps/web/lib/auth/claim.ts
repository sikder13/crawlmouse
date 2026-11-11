/**
 * The claim of an anonymous check (CC-25 D8): the signed-in caller's default account takes the
 * check's site, its owner seat becomes the site's owner, the site gets the tier's schedule, and the
 * check stops expiring.
 *
 * One implementation, called by `POST /api/checks/[id]/claim` and by the sign-in landing's POST when
 * the magic link was a Keep. The check id is the capability (ARCH-2 §4.3): whoever holds it may
 * claim an unowned check, so a check of another account's site is a 404, never a 403.
 *
 * The write that decides the claim is one conditional update (`where account_id is null`); two
 * claims racing for one site cannot both take it. Two claims racing for two sites can pass the site
 * limit together: the limit has no database constraint (spec, known gaps).
 *
 * With `keep` given (door-deps.ts gives it under V2_CHECKS_PUBLIC; CC-22b D7), the two writes are
 * one transaction, `keep_check`, with the move of the check's evidence objects around it
 * (lib/v2/pipeline/keep.ts): the host rule is read before anything is copied, and the database
 * refuses a check that has expired on its own clock. With `firstAudit` given, a kept site whose
 * claimed check failed gets a first audit; a failure there is reported and the claim stands.
 * Without them the claim is the two writes below, as before CC-22b.
 */
import { effectiveTier } from '../entitlement-v2';
import type { DoorStore, FirstAudit, Report, TakeSiteResult } from './door-store';
import { scheduleFor, type SiteSchedule } from './schedule';
import { siteLimitAt } from './site-limit';

export interface ClaimKeepInput {
  checkId: string;
  siteId: string;
  accountId: string;
  ownerSeatId: string;
  schedule: SiteSchedule | null;
}

/** The claim's one-transaction commit and its evidence move, implemented by lib/v2/pipeline/keep.ts. */
export interface ClaimKeep {
  /** Whether the account keeps a site with that host: read before any object is copied. */
  hostKept(accountId: string, host: string): Promise<boolean>;
  /** 'expired' when the database's clock says the check has expired. */
  keep(input: ClaimKeepInput): Promise<TakeSiteResult | 'expired'>;
}

export interface ClaimDeps {
  store: DoorStore;
  now: () => Date;
  keep?: ClaimKeep;
  firstAudit?: FirstAudit;
  /** Where a failed first audit is reported; needed only with `firstAudit`. */
  report?: Report;
}

/** Every way a claim is refused, with its HTTP status. The route answers with these; the spec lists them. */
export const CLAIM_REFUSALS = {
  not_found: {
    status: 404,
    when: 'no check has that id, or the check is of another account’s site',
  },
  already_claimed: {
    status: 409,
    when: 'the account owns the check’s site and the check no longer expires',
  },
  host_kept: { status: 409, when: 'the account already keeps a site with that host' },
  site_limit: {
    status: 409,
    when: 'the account keeps as many sites as its limit, read at its tier now (an expired trial is Free)',
  },
  no_account: {
    status: 409,
    when: 'the caller has no v2 account (a user from before migration 001)',
  },
  expired: { status: 410, when: 'the check expired before anyone kept it' },
} as const;

export type ClaimCode = keyof typeof CLAIM_REFUSALS;

export type ClaimRefusal = {
  [C in ClaimCode]: { ok: false; status: (typeof CLAIM_REFUSALS)[C]['status']; code: C };
}[ClaimCode];

const refuse = <C extends ClaimCode>(code: C) =>
  ({ ok: false, status: CLAIM_REFUSALS[code].status, code }) as Extract<ClaimRefusal, { code: C }>;

export type ClaimResult = { ok: true; siteId: string } | ClaimRefusal;

export async function claimCheck(
  deps: ClaimDeps,
  input: { checkId: string; userId: string },
): Promise<ClaimResult> {
  const { store } = deps;
  const check = await store.loadCheck(input.checkId);
  if (check === null) return refuse('not_found');
  const member = await store.loadMember(input.userId);
  if (member === null) return refuse('no_account');

  const now = deps.now();
  if (check.siteAccountId !== null) {
    if (check.siteAccountId !== member.accountId) return refuse('not_found');
    if (check.expiresAt === null) return refuse('already_claimed');
    // Our site, but the check still expires: an earlier claim stopped between its two writes. That
    // claim tested the expiry before it took the site, so it is finished now, whatever the time.
    // This assumes the claim is the one writer that gives an account's site a check with an expiry.
    await store.clearExpiry(check.checkId);
    return kept(deps, check, input.userId);
  }

  if (check.expiresAt !== null && check.expiresAt.getTime() <= now.getTime()) {
    return refuse('expired');
  }
  const sites = await store.countActiveSites(member.accountId);
  if (sites >= siteLimitAt(member, now)) return refuse('site_limit');

  const site = {
    accountId: member.accountId,
    ownerSeatId: member.ownerSeatId,
    schedule: scheduleFor(effectiveTier(member, now), sites === 0, now, member.timezone),
  };
  if (deps.keep && (await deps.keep.hostKept(member.accountId, check.host))) {
    return refuse('host_kept');
  }
  const taken = deps.keep
    ? await deps.keep.keep({ checkId: check.checkId, siteId: check.siteId, ...site })
    : await store.takeSite(check.siteId, site);
  if (taken === 'expired') return refuse('expired');
  if (taken === 'host_kept') return refuse('host_kept');
  if (taken === 'not_unowned') {
    // Another claim took the site between our read and our write: answer as if we had read after it.
    const after = await store.loadCheck(input.checkId);
    return after?.siteAccountId === member.accountId
      ? refuse('already_claimed')
      : refuse('not_found');
  }
  // `keep_check` cleared the expiry in the transaction that took the site.
  if (!deps.keep) await store.clearExpiry(check.checkId);
  return kept(deps, check, input.userId);
}

/** The claim's success, after the first audit a kept site with no usable check is owed. */
async function kept(
  deps: ClaimDeps,
  check: { siteId: string; host: string },
  userId: string,
): Promise<ClaimResult> {
  if (deps.firstAudit) {
    try {
      await deps.firstAudit({ siteId: check.siteId, host: check.host, userId });
    } catch {
      deps.report?.('first-audit-failed', { siteId: check.siteId });
    }
  }
  return { ok: true, siteId: check.siteId };
}
