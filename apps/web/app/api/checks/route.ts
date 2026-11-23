import type { SupabaseClient } from '@supabase/supabase-js';
import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { IdSchema } from '@crawlmouse/types/v2';
import { checksPublicEnabled, pipelineEnabled } from '@/lib/auth/flags';
import { getClientIp } from '@/lib/client-ip';
import { CRAWL_PAUSED_MESSAGE, isCrawlPaused } from '@/lib/crawl-pause';
import { isSameOrigin } from '@/lib/security/same-origin';
import { supabaseServer } from '@/lib/supabase/server';
import { captureFor, checkStarted } from '@/lib/v2/account/events';
import { viewerFor, type AccountViewer, type ViewerResult } from '@/lib/v2/account/viewer';
import { agencyCaptureFor } from '@/lib/v2/agency/events';
import { UNAVAILABLE_CODES } from '@/lib/v2/unavailable';
import { capturePublicEventAfterResponse } from './_lib/events';
import { scrubbed, startPublicCheck } from './_lib/start';
import { startAccountCheck, type AccountStarted } from './_lib/start-account';
import { accountStartDeps } from './_lib/start-account-deps';
import { startDeps } from './_lib/start-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  url: z.string().min(1).max(2048),
  requestId: IdSchema,
  turnstileToken: z.string().min(1).optional(),
});

const NO_STORE = { 'Cache-Control': 'no-store' };

const answer = (body: object, status: number) =>
  NextResponse.json(body, { status, headers: NO_STORE });

const userIdOf = (viewer: ViewerResult): string | null =>
  viewer.kind === 'signed_out'
    ? null
    : viewer.kind === 'viewer'
      ? viewer.viewer.userId
      : viewer.userId;

/**
 * Start a check from the home form (CC-22b D2; RC-02): `{url, requestId}` → `{checkId}`. A 404 with
 * V2_CHECKS_PUBLIC unset. With V2_PIPELINE unset no function would run a queued check, so the route
 * answers 503 and writes nothing.
 *
 * Who the check is for is read once, from the session (`auth.getUser()`, then `viewerFor`). A
 * person acting in an account gets a check of a site that account keeps (`startAccountCheck`,
 * F-001). Anyone else — signed out, or signed in with no v2 account or with several and none chosen
 * — gets the public start as before (`startPublicCheck`): a site no account keeps, claimed on
 * sign-up. The steps of each, and their order, are those functions'. The session is read for every
 * start whose body parsed, before either branch, so `startPublicCheck`'s own laziness about it (no
 * session read for a caller with no known address, or one stopped by the ceiling) holds for that
 * function and not for this route.
 *
 * Events are sent once the response has gone (`after`), so the answer does not wait on PostHog: the
 * public start's `check_started` when this call queued the check, and for an account the events
 * `/api/sites` and "Run check now" send.
 */
export async function POST(req: Request) {
  if (!checksPublicEnabled()) return NextResponse.json({ code: 'not_found' }, { status: 404 });
  if (!pipelineEnabled()) {
    return answer(
      { code: UNAVAILABLE_CODES.unavailable, error: 'Audits are not available right now.' },
      503,
    );
  }
  if (isCrawlPaused())
    return answer({ error: CRAWL_PAUSED_MESSAGE, code: UNAVAILABLE_CODES.paused }, 503);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return answer({ code: 'invalid_request', error: 'Send a url and a requestId.' }, 400);
  }
  const input = { ...parsed.data, ip: getClientIp(req) };

  // Who the check is for: the session's user, then the account they act in.
  let session: SupabaseClient;
  let viewer: ViewerResult;
  try {
    session = await supabaseServer();
    const {
      data: { user },
    } = await session.auth.getUser();
    viewer = await viewerFor(session, user);
  } catch (cause) {
    console.error('[api/checks] session read failed:', scrubbed(cause, parsed.data));
    return answer(
      { code: 'start_failed', error: 'The audit could not be started. Try again.' },
      500,
    );
  }
  if (viewer.kind === 'viewer') {
    return startForAccount(req, session, viewer.viewer, input, parsed.data);
  }

  const userId = userIdOf(viewer);
  let outcome;
  try {
    outcome = await startPublicCheck(
      startDeps(async () => userId !== null),
      input,
    );
  } catch (cause) {
    console.error('[api/checks] start failed:', scrubbed(cause, parsed.data));
    return answer(
      { code: 'start_failed', error: 'The audit could not be started. Try again.' },
      500,
    );
  }
  if (!outcome.ok) return answer(outcome.body, outcome.status);

  if (outcome.created) {
    const { checkId } = outcome;
    // A check this branch creates is of a site no account keeps (`insertUnkeptSite`): no account.
    await capturePublicEventAfterResponse(
      req,
      'check_started',
      checkId,
      { trigger: 'first_audit' },
      { accountId: null, userId },
    );
  }
  return answer({ checkId: outcome.checkId }, 200);
}

async function startForAccount(
  req: Request,
  session: SupabaseClient,
  viewer: AccountViewer,
  input: Parameters<typeof startAccountCheck>[2],
  logged: { url: string; requestId: string },
): Promise<Response> {
  // A start for an account writes to it, so it takes `/api/sites`' rule: only our own pages. The
  // middleware applies this route's lenient rule, which a request with no Origin passes.
  if (!isSameOrigin(req, new URL(req.url).origin)) {
    return answer({ code: 'cross_site', error: 'Start the audit from crawlmouse.com.' }, 403);
  }
  let outcome;
  try {
    outcome = await startAccountCheck(accountStartDeps(session), viewer, input);
  } catch (cause) {
    console.error('[api/checks] account start failed:', scrubbed(cause, logged));
    return answer(
      { code: 'start_failed', error: 'The audit could not be started. Try again.' },
      500,
    );
  }
  if (!outcome.ok) return answer(outcome.body, outcome.status);
  if (outcome.started !== null) {
    await afterResponse(() => sendStarted(req, viewer, outcome.checkId, outcome.started!));
  }
  return answer({ checkId: outcome.checkId }, 200);
}

/** What `/api/sites` sends for a site it adds, and the re-check route for a check it queues. */
async function sendStarted(
  req: Request,
  viewer: AccountViewer,
  checkId: string,
  started: AccountStarted,
): Promise<void> {
  const capture = captureFor(req);
  const key = { accountId: viewer.account.id, userId: viewer.userId };
  if (started.trigger === 'first_audit') {
    await capture('site_added', key, { n: started.n });
    if (started.n === 1 && viewer.account.kind === 'agency') {
      await agencyCaptureFor(req)('first_client_added', key, {});
    }
  }
  await capture('check_started', key, checkStarted(started.trigger, checkId));
}

/** Next's `after`, or the task awaited here when Next gives no request scope (as `_lib/events.ts`). */
async function afterResponse(task: () => Promise<void>): Promise<void> {
  try {
    after(task);
  } catch {
    await task();
  }
}
