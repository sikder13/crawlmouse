/**
 * Minting a v2 public report (CC-29 D7, Q21): `POST /api/reports/mint` with `{checkId}`, while
 * V2_CHECKS_PUBLIC is on. The route parses the body and hands the work here, with its dependencies
 * injected (`mint-deps.ts` builds them over Supabase).
 *
 * The order is the guard: a signed-in caller (401 otherwise); v1's authed cap, `mint:<user>` at
 * MINT_REPORTS_PER_DAY, with Turnstile once it is spent, as v1's mint does; then, through the
 * caller's own session and before any service-role read, the check as RLS shows it and
 * `is_member_for_site` for its site. A check of another account and a missing check are the same
 * 404. Only a `finished` check mints: a partial one is 409 `check_partial` (the snapshot has no place
 * for what was not measured), any other status 409 `check_not_finished`.
 *
 * Then, with the service role: the report already minted for the check is answered with its slug;
 * otherwise the check is read back and its snapshot built (`buildPublicSnapshot`), and one row is
 * inserted. The row sets neither `listed` nor `indexable`, so the column defaults make it unlisted
 * and noindex (`mint.db.test.ts` reads them back). A unique violation on the check
 * (`public_reports_check_uq`, a concurrent mint) answers the first report's slug; one on the slug is
 * retried with a fresh slug. A new report sends `report_minted {kind: 'v2'}`.
 */
import { MINT_REPORTS_PER_DAY } from '../../limits';
import { isUndefinedColumnError } from '../../pg-errors';
import type { PublicSnapshotV2 } from './snapshot';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SLUG_ATTEMPTS = 3;
const UNIQUE_VIOLATION = '23505';

export interface MintV2Request {
  checkId: string;
  turnstileToken?: string;
}

export interface WriteError {
  code?: string;
  message?: string;
}

export interface MintV2Deps {
  /** The signed-in caller, from their session; null when signed out. */
  user(): Promise<{ id: string } | null>;
  /** The check as the caller's own session reads it (RLS), or null when it shows none. */
  checkAsCaller(checkId: string): Promise<{ siteId: string; status: string } | null>;
  /** `is_member_for_site` through the caller's own session. */
  isMemberForSite(siteId: string): Promise<boolean>;
  checkRateLimit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean }>;
  verifyTurnstile(token: string, ip?: string): Promise<boolean>;
  /** The slug of the report already minted for this check, or null. Service role. */
  slugForCheck(checkId: string): Promise<string | null>;
  /** The finished check read back and its snapshot built, with its site's account. Service role. */
  snapshotOf(
    checkId: string,
    mintedAt: string,
  ): Promise<{ snapshot: PublicSnapshotV2; accountId: string | null }>;
  /** One `public_reports` insert. Service role. */
  insert(row: {
    slug: string;
    audit_id: null;
    check_id: string;
    site_id: string;
    account_id: string;
    domain: string;
    report_snapshot: PublicSnapshotV2;
    minted_by: string;
  }): Promise<{ error: WriteError | null }>;
  reportMinted(accountId: string): Promise<void>;
  newSlug(): string;
  now(): Date;
}

export interface MintAnswer {
  status: number;
  body: { slug: string; alreadyPublic: boolean } | { error: string };
}

const refuse = (status: number, error: string): MintAnswer => ({ status, body: { error } });
const answer = (slug: string, alreadyPublic: boolean): MintAnswer => ({
  status: 200,
  body: { slug, alreadyPublic },
});

export async function mintV2(
  deps: MintV2Deps,
  { checkId, turnstileToken }: MintV2Request,
  ip: string,
): Promise<MintAnswer> {
  const user = await deps.user();
  if (!user) return refuse(401, 'auth_required');

  const cap = await deps.checkRateLimit(`mint:${user.id}`, MINT_REPORTS_PER_DAY, DAY_MS);
  if (!cap.allowed) {
    if (!turnstileToken) return refuse(429, 'captcha_required');
    const ok = await deps.verifyTurnstile(turnstileToken, ip === 'unknown' ? undefined : ip);
    if (!ok) return refuse(429, 'captcha_failed');
  }

  const check = await deps.checkAsCaller(checkId);
  if (!check || !(await deps.isMemberForSite(check.siteId))) return refuse(404, 'not_found');
  if (check.status === 'partial') return refuse(409, 'check_partial');
  if (check.status !== 'finished') return refuse(409, 'check_not_finished');

  const existing = await deps.slugForCheck(checkId);
  if (existing) return answer(existing, true);

  const { snapshot, accountId } = await deps.snapshotOf(checkId, deps.now().toISOString());
  if (accountId === null) return refuse(404, 'not_found');

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = deps.newSlug();
    const { error } = await deps.insert({
      slug,
      audit_id: null,
      check_id: checkId,
      site_id: check.siteId,
      account_id: accountId,
      domain: snapshot.host,
      report_snapshot: snapshot,
      minted_by: user.id,
    });
    if (!error) {
      await deps.reportMinted(accountId);
      return answer(slug, false);
    }
    if (isUndefinedColumnError(error)) return refuse(503, 'minting_unavailable');
    if (error.code !== UNIQUE_VIOLATION) return refuse(500, 'could not mint');
    // A report for this check was minted meanwhile: answer it. Otherwise the slug collided.
    const first = await deps.slugForCheck(checkId);
    if (first) return answer(first, true);
  }
  return refuse(500, 'could not mint');
}
