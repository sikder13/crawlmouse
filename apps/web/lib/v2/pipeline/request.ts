/**
 * requestCheck (CC-20b D13): the pipeline's entry point. It writes the `checks` row (`queued`) and
 * sends `check.requested` with ARCH-2 §4.1's idempotency id. Caps are not enforced here (CC-26b's
 * route does), and no route calls it in this step.
 */
import { canonicalizeUrl, GRADE_VERSION } from '@crawlmouse/engine/v2/pipeline';
import type { Check } from '@crawlmouse/types/v2';
import type { CheckRequested } from '../../../../../inngest/check-events';
import { bucketedKey, checkIdOfKey, freshKey } from './ids';
import { ANONYMOUS_EXPIRY_DAYS, DEFAULT_PAGE_CAP } from './limits';
import type { PipelineStore } from './store';

export interface RequestDeps {
  store: Pick<PipelineStore, 'requestSite' | 'insertQueued'>;
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Inserts the check (`on conflict (id) do nothing`) and sends the event, whose `id` Inngest
 * deduplicates on. The event is sent whether or not the row was new, so a retry after a send that
 * failed still starts the run. `created` says whether this call inserted the row.
 */
export async function requestCheck(
  deps: RequestDeps,
  req: CheckRequest,
): Promise<{ checkId: string; created: boolean }> {
  const site = await deps.store.requestSite(req.siteId);
  const now = deps.now();
  const kept = site.account_id !== null;
  const keyed = { siteId: site.id, kept };
  const bucketed = bucketedKey({
    ...keyed,
    trigger: req.trigger,
    now,
    nextCheckAt: site.next_check_at,
  });
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
    expires_at: kept ? null : new Date(now + ANONYMOUS_EXPIRY_DAYS * DAY_MS).toISOString(),
  });
  await deps.send({
    id: bucketed ?? freshKey(keyed, checkId),
    name: 'check.requested',
    data: {
      checkId,
      siteId: site.id,
      accountId: site.account_id,
      host: site.host,
      homepageUrl: canonicalizeUrl(`https://${site.host}/`),
      trigger: req.trigger,
      pageCap: DEFAULT_PAGE_CAP,
      ...(req.requestedByUserId === undefined ? {} : { requestedByUserId: req.requestedByUserId }),
    },
  });
  return { checkId, created };
}
