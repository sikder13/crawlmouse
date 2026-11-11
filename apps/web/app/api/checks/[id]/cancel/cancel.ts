/**
 * `POST /api/checks/[id]/cancel` (CC-22b D9): cancels a queued or running check through the
 * pipeline's own path.
 *
 * `check.cancel.requested` goes first: it cancels the check's run if one has started
 * (inngest/check.ts, `cancelOn`), and a send that fails leaves the row as it was. Then `failCheck`
 * fails the row `canceled`, which also ends a queued check no run has claimed. `check.failed` is
 * sent with the id the run's own cancel handler sends it with (`checkFailedEventId`), so Inngest
 * delivers one of the two.
 */
import {
  checkFailedEventId,
  type CheckCancelRequested,
  type CheckFailed,
} from '../../../../../../../inngest/check-events';
import { isExpired, readableCheck, type Viewer } from '../../../../../lib/v2/pipeline/public';
import { failCheck } from '../../../../../lib/v2/pipeline/steps/lifecycle';
import type { PipelineStore } from '../../../../../lib/v2/pipeline/store';
import type { CheckReader } from '../../../../../lib/v2/pipeline/types';

export type CancelEvent =
  | { name: 'check.cancel.requested'; data: CheckCancelRequested }
  | { id: string; name: 'check.failed'; data: CheckFailed };

export interface CancelDeps {
  read: CheckReader;
  isMember(siteId: string, userId: string): Promise<boolean>;
  store: Pick<PipelineStore, 'fail' | 'siteOf'>;
  send(event: CancelEvent): Promise<unknown>;
  now(): number;
}

const answer = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

export async function cancel(checkId: string, viewer: Viewer, deps: CancelDeps): Promise<Response> {
  const access = await readableCheck(deps, checkId, viewer);
  if (access === null || isExpired(access, deps.now())) return answer(404, { code: 'not_found' });
  // `fail_check` moves a queued or a running check; a deferred one has no run to cancel yet.
  if (access.status !== 'queued' && access.status !== 'running') {
    return answer(409, { code: 'check_ended' });
  }
  await deps.send({ name: 'check.cancel.requested', data: { checkId } });
  const out = await failCheck(deps.store, checkId, 'canceled');
  // The check ended another way between the read above and the write.
  if (!out.failed) return answer(409, { code: 'check_ended' });
  await deps.send({
    id: checkFailedEventId(checkId),
    name: 'check.failed',
    data: { checkId, siteId: out.siteId, reason: 'canceled' },
  });
  return answer(200, { status: 'canceled' });
}
