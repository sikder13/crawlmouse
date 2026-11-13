/**
 * An operator's re-run of a failed check (CC-33 D2): the pipeline's `requestCheck` for the check's
 * site with trigger `manual`, as a member's re-check (`supabaseRequestRecheck`,
 * lib/v2/account/sites-store.ts), except that the insert is `operator_request_check`, which writes the
 * `rerun_check` record line and the check in one call, and that no requester is named (the operator
 * is not the site's member). The answer is mapped as `supabaseRequestRecheck` maps
 * `request_capped_check`'s: a refusal is thrown out of the insert, before `requestCheck` sends, so a
 * refused re-run sends nothing; it is recorded all the same.
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { inngest } from '../../../../../inngest/client';
import type { RecheckOutcome } from '../account/recheck';
import { globalSlot } from '../account/sites-store';
import { MANUAL_BUCKET_S } from '../pipeline/limits';
import { requestCheck, type RequestDeps } from '../pipeline/request';
import { supabasePipelineStore, type QueuedCheck } from '../pipeline/store';

const Iso = z.iso.datetime();

const Answer = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('created') }),
  z.strictObject({ outcome: z.literal('exists'), status: z.string() }),
  z.strictObject({ outcome: z.literal('capped'), next_allowed_at: Iso }),
  z.strictObject({ outcome: z.literal('capacity') }),
  z.strictObject({ outcome: z.literal('removed') }),
  z.strictObject({ outcome: z.literal('paused'), paused_reason: z.string() }),
]);

class NotQueued extends Error {
  constructor(readonly outcome: RecheckOutcome & { queued: false }) {
    super(`re-run not queued: ${outcome.reason}`);
  }
}

const bucketEnd = (atMs: number): string => {
  const ms = MANUAL_BUCKET_S * 1000;
  return new Date((Math.floor(atMs / ms) + 1) * ms).toISOString();
};

export interface RerunRequest {
  /** The failed check the operator re-runs: the record's target. */
  failedCheckId: string;
  siteId: string;
  /** `manualChecksPerSiteDay` of the site's own account. */
  cap: number;
  reason: string;
  send?: RequestDeps['send'];
}

export async function operatorRerun(
  admin: SupabaseClient,
  operatorId: string,
  req: RerunRequest,
): Promise<RecheckOutcome> {
  const pipeline = supabasePipelineStore(admin);
  const deps: RequestDeps = {
    store: {
      requestSite: (siteId) => pipeline.requestSite(siteId),
      checkStatus: (checkId) => pipeline.checkStatus!(checkId),
      insertQueued: async (row: QueuedCheck) => {
        const { data, error } = await admin.rpc('operator_request_check', {
          p_operator: operatorId,
          p_target: req.failedCheckId,
          p_reason: req.reason,
          p_row: row,
          p_cap: req.cap,
          p_global: globalSlot(Date.now()),
        });
        if (error) throw new Error(`operator_request_check failed: ${error.message}`);
        const a = Answer.parse(data);
        switch (a.outcome) {
          case 'created':
            return true;
          case 'exists':
            if (a.status === 'queued') return false;
            if (a.status === 'running') {
              throw new NotQueued({ queued: false, reason: 'check_running', checkId: row.id });
            }
            throw new NotQueued({
              queued: false,
              reason: 'recently_checked',
              nextAllowedAt: bucketEnd(Date.parse(row.queued_at)),
            });
          case 'capped':
            throw new NotQueued({
              queued: false,
              reason: 'capped',
              nextAllowedAt: a.next_allowed_at,
            });
          case 'capacity':
          case 'removed':
          case 'paused':
            throw new NotQueued({ queued: false, reason: a.outcome });
        }
      },
    },
    send: req.send ?? ((event) => inngest.send(event)),
    now: () => Date.now(),
    newId: randomUUID,
  };
  try {
    const r = await requestCheck(deps, { siteId: req.siteId, trigger: 'manual' });
    return { queued: true, checkId: r.checkId, created: r.created };
  } catch (e) {
    if (e instanceof NotQueued) return e.outcome;
    throw e;
  }
}
