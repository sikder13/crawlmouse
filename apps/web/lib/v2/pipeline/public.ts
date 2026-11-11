/**
 * Reading a check from outside the pipeline (CC-22b D3): who may read which check, and the shapes
 * the audit pages, the progress stream and the notify and cancel routes share.
 *
 * The rule. A check on a site no account keeps is read by its id, which is the capability. A check
 * on a kept site is read by a member of that site (`isMember`, which production answers with the
 * caller's own database role, so the rule is `is_member_for_site`). `readableCheck` answers null for
 * an id that is not a uuid, a check that does not exist, a check of a removed site and a check the
 * viewer may not read, and its callers turn null into a 404.
 */
import { stableId, type MapDrawing } from '@crawlmouse/engine/v2/pipeline';
import type { Check } from '@crawlmouse/types/v2';
import { isFailureReason, type FailureReason } from '../../../../../inngest/check-events';
import type { CheckDataset, CheckReader, EvidenceStore } from './types';

/** What a viewer's plan opens of a check's fixes: the Free three, or each of them. */
export type FixPlan = 'free' | 'pro';

export interface Viewer {
  /** The signed-in user's id; null for a visitor with no session. */
  userId: string | null;
}

export interface PublicCheckDeps {
  /** A service-role reader: it sees every row, so `readableCheck` decides before anything is returned. */
  read: CheckReader;
  evidence: Pick<EvidenceStore, 'get'>;
  /** Whether `userId` is a member of `siteId`'s account with that site in scope. */
  isMember(siteId: string, userId: string): Promise<boolean>;
  /** What the account's tier opens of a check's fixes, at `now`. */
  planOf(accountId: string): Promise<FixPlan>;
  /** Milliseconds since the epoch. */
  now(): number;
}

/** A check the viewer may read, as its row and its site's row hold it. */
export interface CheckAccess {
  checkId: string;
  siteId: string;
  /** Null for a site no account keeps. */
  accountId: string | null;
  host: string;
  status: Check['status'];
  trigger: Check['trigger'];
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
  failureReason: FailureReason | null;
  progress: Check['progress'];
  /** The stored map drawing's path in the evidence bucket; null when none was drawn. */
  mapPath: string | null;
}

/** What `/audit/[id]` shows for a check the viewer may read. */
export type CheckRead =
  | {
      state: 'waiting';
      checkId: string;
      host: string;
      status: 'queued' | 'running' | 'deferred';
      queuedAt: string;
      startedAt: string | null;
      progress: Check['progress'];
      kept: boolean;
    }
  | {
      state: 'ready';
      checkId: string;
      host: string;
      kept: boolean;
      /** `free` for a check no account keeps; a kept check's is its account's (`planOf`). */
      plan: FixPlan;
      dataset: CheckDataset;
      /** The drawing stored when the check was built; null when there is none to read. */
      map: MapDrawing | null;
    }
  | {
      state: 'failed';
      checkId: string;
      host: string;
      failedAt: string;
      reason: FailureReason;
      kept: boolean;
    }
  | {
      state: 'expired';
      checkId: string;
      host: string;
      expiredAt: string;
      finishedAt: string | null;
    };

/** `loadCheckFor`'s signature (pipeline/load-for.ts): null is a 404. */
export type LoadCheckFor = (
  deps: PublicCheckDeps,
  id: string,
  viewer: Viewer,
) => Promise<CheckRead | null>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export async function readableCheck(
  deps: Pick<PublicCheckDeps, 'read' | 'isMember'>,
  id: string,
  viewer: Viewer,
): Promise<CheckAccess | null> {
  if (!UUID.test(id)) return null;
  const [check] = await deps.read.rows('checks', 'id', [id]);
  if (!check) return null;
  const siteId = String(check.site_id);
  const [site] = await deps.read.rows('sites', 'id', [siteId]);
  if (!site || site.removed_at !== null) return null;
  const accountId = text(site.account_id);
  if (accountId !== null) {
    if (viewer.userId === null) return null;
    if (!(await deps.isMember(siteId, viewer.userId))) return null;
  }
  const reason = check.failure_reason;
  return {
    checkId: String(check.id),
    siteId,
    accountId,
    host: String(site.host),
    status: check.status as Check['status'],
    trigger: check.trigger as Check['trigger'],
    queuedAt: String(check.queued_at),
    startedAt: text(check.started_at),
    finishedAt: text(check.finished_at),
    expiresAt: text(check.expires_at),
    failureReason: isFailureReason(reason) ? reason : null,
    progress: (check.progress ?? null) as Check['progress'],
    mapPath: text(check.map_path),
  };
}

/** Whether the check's `expires_at` has passed at `now` (milliseconds). A kept check has none. */
export const isExpired = (access: Pick<CheckAccess, 'expiresAt'>, now: number): boolean =>
  access.expiresAt !== null && Date.parse(access.expiresAt) <= now;

/**
 * The ids of the check and the unkept site a public start makes (D2): derived from the caller's
 * request id and the host, so a retried request names the same two rows.
 */
export const publicCheckId = (requestId: string, host: string): string =>
  stableId('public_check', requestId, host);
export const publicSiteId = (requestId: string, host: string): string =>
  stableId('public_site', requestId, host);

/**
 * How a product event names a check. The check id is the capability to read the check, so events
 * carry this hash of it instead.
 */
export const checkRef = (checkId: string): string => stableId('check_ref', checkId);
