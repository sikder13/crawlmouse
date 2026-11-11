import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { IdSchema } from '@crawlmouse/types/v2';
import { checksPublicEnabled, pipelineEnabled } from '@/lib/auth/flags';
import { getClientIp } from '@/lib/client-ip';
import { CRAWL_PAUSED_MESSAGE, isCrawlPaused } from '@/lib/crawl-pause';
import { supabaseServer } from '@/lib/supabase/server';
import { UNAVAILABLE_CODES } from '@/lib/v2/unavailable';
import { capturePublicEvent } from './_lib/events';
import { scrubbed, startPublicCheck } from './_lib/start';
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

async function signedIn(): Promise<boolean> {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return user !== null;
}

/**
 * Start a check of a public site for a visitor (CC-22b D2): `{url, requestId}` → `{checkId}`. The
 * steps after the body has parsed, and their order, are `startPublicCheck`'s. A 404 with
 * V2_CHECKS_PUBLIC unset. With V2_PIPELINE unset no function would run a queued check, so the route
 * answers 503 and writes nothing. `check_started` is sent when this call queued the check, and not
 * for a request that was answered with a check already there. The send is handed to `after`, which
 * runs it once the response has gone, so the answer does not wait on PostHog.
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

  let outcome;
  try {
    outcome = await startPublicCheck(startDeps(signedIn), { ...parsed.data, ip: getClientIp(req) });
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
    after(() => capturePublicEvent(req, 'check_started', checkId, { trigger: 'first_audit' }));
  }
  return answer({ checkId: outcome.checkId }, 200);
}
