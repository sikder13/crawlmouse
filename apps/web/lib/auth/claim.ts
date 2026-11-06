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
 * limit together: the limit has no database constraint (spec, known gaps). The Storage move of the
 * check's evidence objects is CC-20b's.
 */
import { effectiveTier } from '../entitlement-v2';
import type { DoorStore } from './door-store';
import { scheduleFor } from './schedule';

export interface ClaimDeps {
  store: DoorStore;
  now: () => Date;
}

export type ClaimRefusal =
  | { ok: false; status: 404; code: 'not_found' }
  | { ok: false; status: 409; code: 'already_claimed' | 'host_kept' | 'site_limit' | 'no_account' }
  | { ok: false; status: 410; code: 'expired' };

export type ClaimResult = { ok: true; siteId: string } | ClaimRefusal;

export async function claimCheck(
  deps: ClaimDeps,
  input: { checkId: string; userId: string },
): Promise<ClaimResult> {
  const { store } = deps;
  const check = await store.loadCheck(input.checkId);
  if (check === null) return { ok: false, status: 404, code: 'not_found' };
  const member = await store.loadMember(input.userId);
  if (member === null) return { ok: false, status: 409, code: 'no_account' };

  if (check.siteAccountId !== null) {
    if (check.siteAccountId !== member.accountId)
      return { ok: false, status: 404, code: 'not_found' };
    if (check.expiresAt === null) return { ok: false, status: 409, code: 'already_claimed' };
    // Our site, but the check still expires: an earlier claim stopped between its two writes.
    await store.clearExpiry(check.checkId);
    return { ok: true, siteId: check.siteId };
  }

  const now = deps.now();
  if (check.expiresAt !== null && check.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, status: 410, code: 'expired' };
  }
  const kept = await store.countActiveSites(member.accountId);
  if (kept >= member.siteLimit) return { ok: false, status: 409, code: 'site_limit' };

  const taken = await store.takeSite(check.siteId, {
    accountId: member.accountId,
    ownerSeatId: member.ownerSeatId,
    schedule: scheduleFor(effectiveTier(member, now), kept === 0, now, member.timezone),
  });
  if (taken === 'host_kept') return { ok: false, status: 409, code: 'host_kept' };
  if (taken === 'not_unowned') {
    // Another claim took the site between our read and our write: answer as if we had read after it.
    const after = await store.loadCheck(input.checkId);
    return after?.siteAccountId === member.accountId
      ? { ok: false, status: 409, code: 'already_claimed' }
      : { ok: false, status: 404, code: 'not_found' };
  }
  await store.clearExpiry(check.checkId);
  return { ok: true, siteId: check.siteId };
}
