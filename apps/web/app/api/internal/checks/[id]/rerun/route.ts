import { pipelineEnabled } from '@/lib/auth/flags';
import { isCrawlPaused } from '@/lib/crawl-pause';
import { supabaseServer } from '@/lib/supabase/server';
import { isId, notFound, readBody } from '@/lib/v2/account/route';
import { readEntitlement } from '@/lib/v2/account/viewer-read';
import { doneTo, readReason, type DoneCode } from '@/lib/v2/ops/actions';
import { supabaseConsoleStore } from '@/lib/v2/ops/console-store';
import { consoleAdmin, requireOperator } from '@/lib/v2/ops/operator';
import { operatorRerun } from '@/lib/v2/ops/rerun';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The support console's re-run of a failed check (CC-33 D2). Anyone but an operator gets 404, before
 * anything is read. The check must exist, have failed, and belong to a site an account keeps (404
 * otherwise); the form's `reason` is required. It goes through the start path a member's re-check
 * takes, with the site's own account's cap (`manualChecksPerSiteDay`) and the platform's daily
 * ceiling, and `operator_request_check` writes the record line in the call that queues the check.
 * Every answer but a 404 is a 303 to the account's page with the outcome as `?done=`.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const proof = await requireOperator(await supabaseServer());
  if (!proof) return notFound();
  const { id } = await params;
  if (!isId(id)) return notFound();
  const admin = consoleAdmin(proof);
  const target = await supabaseConsoleStore(admin, proof.userId).rerunTarget(id);
  if (target === null || target.accountId === null) return notFound();
  const accountId = target.accountId;
  const back = (code: DoneCode) => doneTo(accountId, code);

  const body = await readBody(req);
  const reason = body === null ? null : readReason(body.fields);
  if (reason === null) return back('reason_invalid');
  if (isCrawlPaused()) return back('paused');
  if (!pipelineEnabled()) return back('unavailable');
  if (target.status !== 'failed') return back('not_failed');
  if (target.removedAt !== null) return back('site_removed');
  if (target.pausedReason !== null) return back('site_paused');
  const entitlement = await readEntitlement(admin, accountId, new Date());
  if (entitlement === null) return notFound();

  const outcome = await operatorRerun(admin, proof.userId, {
    failedCheckId: target.checkId,
    siteId: target.siteId,
    cap: entitlement.gates.manualChecksPerSiteDay,
    reason,
  });
  if (outcome.queued) return back(outcome.created ? 'rerun_queued' : 'rerun_exists');
  switch (outcome.reason) {
    case 'removed':
      return back('site_removed');
    case 'paused':
      return back('site_paused');
    default:
      return back(outcome.reason);
  }
}
