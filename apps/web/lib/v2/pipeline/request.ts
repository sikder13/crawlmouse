/**
 * requestCheck (CC-20b D13): the pipeline's entry point. It writes the `checks` row (`queued`) and
 * sends `check.requested` with ARCH-2 §4.1's idempotency id. Caps are not enforced here (CC-26b's
 * route does), and no route calls it in this step.
 */
import { canonicalizeUrl, GRADE_VERSION } from '@crawlmouse/engine/v2/pipeline';
import type { Check } from '@crawlmouse/types/v2';
import type { CheckRequested } from '../../../../../inngest/check-events';
import { bucketedKey, checkIdOfKey, freshKey } from './ids';
import { ANONYMOUS_EXPIRY_HOURS, DEFAULT_PAGE_CAP, MANUAL_BUCKET_S } from './limits';
import type { PipelineStore } from './store';

export interface RequestDeps {
  store: Pick<PipelineStore, 'requestSite' | 'insertQueued' | 'checkStatus'>;
  send(event: { id: string; name: 'check.requested'; data: CheckRequested }): Promise<unknown>;
  /** Milliseconds since the epoch. */
  now(): number;
  /** A fresh check id, for a request that is not bucketed. */
  newId(): string;
}

export interface CheckRequest {
  siteId: string;
  trigger: Check['trigger'];
  requestedByUserId?: string;
}

const HOUR_MS = 60 * 60 * 1000;

/** Where a site's crawl starts: its host's root, in the engine's canonical spelling. */
export const homepageOf = (host: string): string => canonicalizeUrl(`https://${host}/`);

/**
 * Inserts the check (`on conflict (id) do nothing`) and sends the event, whose `id` Inngest
 * deduplicates on. `created` says whether this call inserted the row.
 *
 * Retries (correctness 7). A bucketed request (`manual`, `fix_recheck`, `deploy` and `scheduled` for
 * a kept site) takes its check id from its key, so a retry in the same bucket after a send that failed
 * finds the row and sends the same event id, and the run starts once. A request keyed by a fresh check
 * id (`first_audit`, and any request for a site no account keeps) has no such key: a retry writes a
 * second row and sends a second event. Its caller (CC-22b) needs an idempotency key of its own.
 */
export async function requestCheck(
  deps: RequestDeps,
  req: CheckRequest,
): Promise<{ checkId: string; created: boolean }> {
  const site = await deps.store.requestSite(req.siteId);
  const now = deps.now();
  const kept = site.account_id !== null;
  const keyed = { siteId: site.id, kept };
  const key = (at: number) =>
    bucketedKey({ ...keyed, trigger: req.trigger, now: at, nextCheckAt: site.next_check_at });
  let bucketed = key(now);
  // D11: a re-check whose bucket's check has left `queued` (started or ended) goes to the next
  // bucket, so asking again is a new check rather than the one already under way. Only when the
  // store reads statuses (`checkStatus`); without it the bucket is kept.
  if (
    bucketed !== null &&
    (req.trigger === 'manual' || req.trigger === 'fix_recheck') &&
    deps.store.checkStatus !== undefined
  ) {
    const status = await deps.store.checkStatus(checkIdOfKey(bucketed));
    if (status !== null && status !== 'queued') bucketed = key(now + MANUAL_BUCKET_S * 1000);
  }
  const checkId = bucketed === null ? deps.newId() : checkIdOfKey(bucketed);
  const at = new Date(now).toISOString();
  const created = await deps.store.insertQueued({
    id: checkId,
    site_id: site.id,
    trigger: req.trigger,
    grade_version: GRADE_VERSION,
    queued_at: at,
    // Q9: a queued check has a heartbeat from the start, so the reaper can tell it is waiting.
    heartbeat_at: at,
    expires_at: kept ? null : new Date(now + ANONYMOUS_EXPIRY_HOURS * HOUR_MS).toISOString(),
  });
  await deps.send({
    id: bucketed ?? freshKey(keyed, checkId),
    name: 'check.requested',
    data: {
      checkId,
      siteId: site.id,
      accountId: site.account_id,
      host: site.host,
      homepageUrl: homepageOf(site.host),
      trigger: req.trigger,
      pageCap: DEFAULT_PAGE_CAP,
      ...(req.requestedByUserId === undefined ? {} : { requestedByUserId: req.requestedByUserId }),
    },
  });
  return { checkId, created };
}
