/**
 * Goal 1 row 25: an agency attaches, checks and removes its portal host. The routes
 * (`app/api/agency/domain`) check the caller, then call these with a store over `agency_brands`
 * (service role), the Vercel port and a TXT resolver. Every step refuses before the next runs.
 *
 * The states, in `agency_brands.portal_domain_status`:
 * - `unverified`   the host is stored with a TXT token; nothing is attached;
 * - `txt_verified` `_crawlmouse.<host>` holds the token: the agency controls the host's DNS;
 * - `pending`      attached to the Vercel project, waiting for Vercel to verify it and its CNAME;
 * - `verified`     Vercel serves it with a certificate; the portal routes serve it;
 * - `error`        Vercel refused it (another project or team holds it).
 *
 * The host is attached to Vercel only from `txt_verified` on (row 25 b), and a host another account
 * holds, at any state, is refused by `portal_domain`'s unique constraint.
 */
import 'server-only';
import { normalizeHost, portalHostRefusal, type PortalHostRefusal } from './portal-host';
import type { VercelChallenge, VercelDomains, VercelFailure } from './vercel-domains';

export type DomainStatus = 'unverified' | 'txt_verified' | 'pending' | 'verified' | 'error';

/** The account's portal columns, as stored. */
export interface DomainRow {
  host: string;
  status: DomainStatus;
  txtToken: string | null;
  txtVerifiedAt: string | null;
  cnameFound: boolean;
  certificateAt: string | null;
  vercelAddedAt: string | null;
}

/** The columns a step writes; any omitted is left as it is. */
export type DomainPatch = Partial<{
  status: DomainStatus;
  txtVerifiedAt: string;
  cnameFound: boolean;
  certificateAt: string | null;
  vercelAddedAt: string;
}>;

export interface DomainStore {
  /** The account's host, null when it has none, `no_brand` when it has no brand row. */
  read(accountId: string): Promise<DomainRow | null | 'no_brand'>;
  /**
   * Stores `host` as the account's, `unverified`, with `token`, only while the account holds no
   * host. `in_use` when another account holds it (the unique constraint).
   */
  claim(
    accountId: string,
    host: string,
    token: string,
  ): Promise<'claimed' | 'in_use' | 'has_host' | 'no_brand'>;
  /** Writes `patch` only while the account still holds `host`; false when it no longer does. */
  update(accountId: string, host: string, patch: DomainPatch): Promise<boolean>;
  /** Clears every portal column, only while the account still holds `host`. */
  clear(accountId: string, host: string): Promise<boolean>;
}

/** `node:dns` `resolveTxt`'s shape: each record's strings, which a long record splits. */
export type ResolveTxt = (name: string) => Promise<string[][]>;

export interface DomainDeps {
  store: DomainStore;
  vercel: VercelDomains;
  /** Whether `vercel` holds the owner's token; without it, check and remove refuse first. */
  vercelConfigured: boolean;
  resolveTxt: ResolveTxt;
  newToken(): string;
  now(): Date;
}

/** The TXT record the agency adds, under `_crawlmouse.<host>`. */
export const TXT_PREFIX = '_crawlmouse.';
export const TXT_VALUE_PREFIX = 'crawlmouse-verify=';

/** What the agency is shown: the records to add and where the host stands. */
export interface DomainView {
  host: string;
  status: DomainStatus;
  txt: { name: string; value: string } | null;
  /** The CNAME target, once Vercel names it for this host. */
  cname: string | null;
  /** Vercel's own TXT challenge, when another team used the host before. */
  vercelChallenges: VercelChallenge[];
}

export type DomainAnswer =
  | { ok: true; view: DomainView }
  | {
      ok: false;
      status: 400 | 404 | 409 | 502 | 503;
      code:
        | 'invalid_host'
        | 'no_brand'
        | 'has_host'
        | 'in_use'
        | 'no_host'
        | 'domain_service_unconfigured'
        | 'domain_service_failed'
        | 'changed';
      reason?: PortalHostRefusal;
    };

const viewOf = (row: DomainRow, extra: Partial<DomainView> = {}): DomainView => ({
  host: row.host,
  status: row.status,
  txt:
    row.txtToken === null
      ? null
      : { name: `${TXT_PREFIX}${row.host}`, value: `${TXT_VALUE_PREFIX}${row.txtToken}` },
  cname: null,
  vercelChallenges: [],
  ...extra,
});

const failed = (f: VercelFailure): DomainAnswer =>
  f === 'not_configured'
    ? { ok: false, status: 503, code: 'domain_service_unconfigured' }
    : f === 'in_use'
      ? { ok: false, status: 409, code: 'in_use' }
      : { ok: false, status: 502, code: 'domain_service_failed' };

/** Stores a host the attach rules accept, with a fresh TXT token. Nothing is attached yet. */
export async function claimDomain(
  deps: DomainDeps,
  accountId: string,
  raw: string,
): Promise<DomainAnswer> {
  const reason = portalHostRefusal(raw);
  if (reason !== null) return { ok: false, status: 400, code: 'invalid_host', reason };
  const host = normalizeHost(raw);
  const token = deps.newToken();
  const claimed = await deps.store.claim(accountId, host, token);
  if (claimed === 'in_use') return { ok: false, status: 409, code: 'in_use' };
  if (claimed === 'has_host') return { ok: false, status: 409, code: 'has_host' };
  if (claimed === 'no_brand') return { ok: false, status: 409, code: 'no_brand' };
  return {
    ok: true,
    view: viewOf({
      host,
      status: 'unverified',
      txtToken: token,
      txtVerifiedAt: null,
      cnameFound: false,
      certificateAt: null,
      vercelAddedAt: null,
    }),
  };
}

/** Whether `_crawlmouse.<host>` holds the token. A lookup failure is "not found", never a match. */
export async function txtHolds(
  resolveTxt: ResolveTxt,
  host: string,
  token: string,
): Promise<boolean> {
  const want = `${TXT_VALUE_PREFIX}${token}`;
  try {
    const records = await resolveTxt(`${TXT_PREFIX}${host}`);
    return records.some((parts) => parts.join('').trim() === want);
  } catch {
    return false;
  }
}

/**
 * Moves the host as far as its DNS and Vercel allow, one state at a time, writing each state as it
 * is reached. Without the owner's token it refuses before reading anything. The TXT record is read
 * on every check until it matches, and the host is attached only once it has.
 */
export async function checkDomain(deps: DomainDeps, accountId: string): Promise<DomainAnswer> {
  if (!deps.vercelConfigured)
    return { ok: false, status: 503, code: 'domain_service_unconfigured' };
  const row = await deps.store.read(accountId);
  if (row === 'no_brand' || row === null) return { ok: false, status: 404, code: 'no_host' };
  const write = async (patch: DomainPatch): Promise<DomainRow | null> =>
    (await deps.store.update(accountId, row.host, patch)) ? { ...row, ...patch } : null;
  let at: DomainRow = row;

  // 1. Control of the host's DNS, proved by the TXT record.
  if (at.txtVerifiedAt === null) {
    if (at.txtToken === null || !(await txtHolds(deps.resolveTxt, at.host, at.txtToken))) {
      return { ok: true, view: viewOf(at) };
    }
    const next = await write({ status: 'txt_verified', txtVerifiedAt: deps.now().toISOString() });
    if (next === null) return { ok: false, status: 409, code: 'changed' };
    at = next;
  }

  // 2. Attached to the project: only now, after the TXT proof.
  let challenges: VercelChallenge[] = [];
  if (at.vercelAddedAt === null) {
    const added = await deps.vercel.add(at.host);
    if (!added.ok) {
      if (added.failure === 'in_use') await write({ status: 'error' });
      return failed(added.failure);
    }
    const next = await write({ status: 'pending', vercelAddedAt: deps.now().toISOString() });
    if (next === null) {
      // The host was removed or replaced while it was being attached: take it back off.
      await deps.vercel.remove(at.host);
      return { ok: false, status: 409, code: 'changed' };
    }
    at = next;
    if (!added.value.verified) challenges = added.value.challenges;
  } else {
    const got = await deps.vercel.get(at.host);
    if (!got.ok) return failed(got.failure);
    if (!got.value.verified) {
      const tried = await deps.vercel.verify(at.host);
      if (!tried.ok) return failed(tried.failure);
      if (!tried.value.verified) challenges = tried.value.challenges;
    }
  }
  if (challenges.length > 0) {
    return { ok: true, view: viewOf(at, { vercelChallenges: challenges }) };
  }

  // 3. The CNAME, and the certificate Vercel can issue once it points at us.
  const config = await deps.vercel.config(at.host);
  if (!config.ok) return failed(config.failure);
  const { configured, cname } = config.value;
  if (configured && at.status !== 'verified') {
    const next = await write({
      status: 'verified',
      cnameFound: true,
      certificateAt: deps.now().toISOString(),
    });
    if (next === null) return { ok: false, status: 409, code: 'changed' };
    at = next;
  } else if (!configured && at.status === 'verified') {
    // Served before and pointing elsewhere now: stop serving it until it points at us again.
    const next = await write({ status: 'pending', cnameFound: false, certificateAt: null });
    if (next === null) return { ok: false, status: 409, code: 'changed' };
    at = next;
  }
  return { ok: true, view: viewOf(at, { cname }) };
}

/**
 * Takes the host off the Vercel project first, then clears its columns, so a host is never left on
 * the project with no row that owns it. If Vercel refuses, the row is kept and the answer says so.
 */
export async function removeDomain(deps: DomainDeps, accountId: string): Promise<DomainAnswer> {
  const row = await deps.store.read(accountId);
  if (row === 'no_brand' || row === null) return { ok: false, status: 404, code: 'no_host' };
  if (row.vercelAddedAt !== null) {
    if (!deps.vercelConfigured) {
      return { ok: false, status: 503, code: 'domain_service_unconfigured' };
    }
    const removed = await deps.vercel.remove(row.host);
    if (!removed.ok) return failed(removed.failure);
  }
  if (!(await deps.store.clear(accountId, row.host))) {
    return { ok: false, status: 409, code: 'changed' };
  }
  return { ok: true, view: { ...viewOf(row), status: 'unverified', txt: null } };
}
