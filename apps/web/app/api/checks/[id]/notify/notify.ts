/**
 * `POST /api/checks/[id]/notify {email}` (CC-22b D9): stores where to send a check's result and
 * emits `check.notify_requested`. Nothing is sent to the address here (CC-28 sends).
 *
 * The address is stored in `checks.notify_email`. It is not in the response, the event or a log
 * line of this file, and the per-address limit's bucket is keyed by a hash of it, because the
 * limiter stores its key and logs it when its database call fails (lib/rate-limit.ts).
 */
import { z } from 'zod';
import { stableId } from '@crawlmouse/engine/v2/pipeline';
import type { CheckNotifyRequested } from '../../../../../../../inngest/check-events';
import { NOTIFY_PER_EMAIL_PER_DAY, NOTIFY_PER_IP_PER_DAY } from '../../../../../lib/limits';
import { isExpired, readableCheck, type Viewer } from '../../../../../lib/v2/pipeline/public';
import type { StreamStore } from '../../../../../lib/v2/pipeline/stream-store';
import type { CheckReader } from '../../../../../lib/v2/pipeline/types';

const DAY_MS = 24 * 60 * 60 * 1000;

const BodySchema = z.object({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()) });

/** One `check.notify_requested` per check within Inngest's 24-hour deduplication of event ids. */
export const notifyEventId = (checkId: string): string => `check-notify:${checkId}`;

export interface NotifyEvent {
  id: string;
  name: 'check.notify_requested';
  data: CheckNotifyRequested;
}

export interface NotifyDeps {
  read: CheckReader;
  isMember(siteId: string, userId: string): Promise<boolean>;
  store: Pick<StreamStore, 'setNotifyEmail'>;
  limit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean }>;
  send(event: NotifyEvent): Promise<unknown>;
  clientIp(req: Request): string;
  now(): number;
}

const answer = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

/** `body` is the request's JSON as the route read it; null when it was not JSON. */
export async function notify(
  req: Request,
  body: unknown,
  checkId: string,
  viewer: Viewer,
  deps: NotifyDeps,
): Promise<Response> {
  const access = await readableCheck(deps, checkId, viewer);
  if (access === null || isExpired(access, deps.now())) return answer(404, { code: 'not_found' });

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return answer(400, { code: 'invalid_email' });
  const { email } = parsed.data;

  const byIp = await deps.limit(`notify:ip:${deps.clientIp(req)}`, NOTIFY_PER_IP_PER_DAY, DAY_MS);
  if (!byIp.allowed) return answer(429, { code: 'rate_limited' });
  const byEmail = await deps.limit(
    `notify:email:${stableId('notify_email', email)}`,
    NOTIFY_PER_EMAIL_PER_DAY,
    DAY_MS,
  );
  if (!byEmail.allowed) return answer(429, { code: 'rate_limited' });

  if (!(await deps.store.setNotifyEmail(checkId, email))) {
    return answer(409, { code: 'check_ended' });
  }
  await deps.send({
    id: notifyEventId(checkId),
    name: 'check.notify_requested',
    data: { checkId, siteId: access.siteId },
  });
  return answer(200, { ok: true });
}
