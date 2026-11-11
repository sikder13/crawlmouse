/**
 * The fix routes' service-role reads and their one write (CC-26b D5, D9). A route makes this store
 * only after the caller's own session has answered `is_member_for_fix` for the fix: `site_fixes` and
 * `fix_events` have no client grant, so these reads cannot be made with the caller's client.
 *
 * Its one write of a fix is `mark_fix_done` (migration 20261112000001), which sets the status and
 * appends its `fix_events` row in one transaction; the one-writer guard in
 * lib/v2/pipeline/persist.test.ts holds this file to that function. It also records a developer
 * email request as a `fix_email_requests` row, which holds the address (owner ruling Q8).
 */
import { randomUUID } from 'node:crypto';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Check, Fix, FixEvent } from '@crawlmouse/types/v2';
import { z } from 'zod';
import { supabaseCheckReader } from '../pipeline/load';
import { checkFromRow, fixEventFromRow, fixFromRow } from '../pipeline/rows';
import type { CheckReader } from '../pipeline/types';

export const MARK_FIX_DONE_RPC = 'mark_fix_done';

/** What `mark_fix_done` answers. */
export type MarkOutcome =
  | { outcome: 'marked'; eventId: string; at: string }
  | { outcome: 'already' | 'not_found' | 'removed' }
  | { outcome: 'refused'; status: string };

const MarkAnswer = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('marked'), event_id: z.uuid(), at: z.string() }),
  z.strictObject({ outcome: z.enum(['already', 'not_found', 'removed']) }),
  z.strictObject({ outcome: z.literal('refused'), status: z.string() }),
]);

/** What the routes read to decide whether a Free account sees a fix (`fixes.ts`). */
export interface SiteFixes {
  /** The site's finished and partial checks. */
  checks: Check[];
  fixes: Fix[];
  events: FixEvent[];
}

export interface FixesStore {
  /** The fix, or null when there is none. */
  fix(fixId: string): Promise<Fix | null>;
  siteFixes(siteId: string): Promise<SiteFixes>;
  markDone(fixId: string, seatId: string): Promise<MarkOutcome>;
  /** Records the request and returns its id. */
  requestEmail(req: EmailRequest): Promise<string>;
}

export interface EmailRequest {
  fixId: string;
  accountId: string;
  seatId: string;
  to: string;
}

function rows(what: string, r: { data: unknown; error: PostgrestError | null }) {
  if (r.error) throw new Error(`fixes-store: ${what}: ${r.error.code} ${r.error.message}`);
  return (r.data ?? []) as Record<string, unknown>[];
}

/**
 * `reader` reads a site's checks, fixes and events page by page (`supabaseCheckReader`, the same
 * reader the check loader uses); a test passes its own.
 */
export function supabaseFixesStore(
  admin: SupabaseClient,
  reader: CheckReader = supabaseCheckReader(admin),
): FixesStore {
  return {
    async fix(fixId) {
      const [row] = rows(
        'site_fixes read',
        await admin.from('site_fixes').select('*').eq('id', fixId).limit(1),
      );
      return row ? fixFromRow(row) : null;
    },

    async siteFixes(siteId) {
      // Through the paged reader: a site's checks and fix events can pass PostgREST's row cap.
      const [checkRows, fixRows] = await Promise.all([
        reader.rows('checks', 'site_id', [siteId]),
        reader.rows('site_fixes', 'site_id', [siteId]),
      ]);
      const fixes = fixRows.map(fixFromRow);
      const events = await reader.rows(
        'fix_events',
        'fix_id',
        fixes.map((f) => f.id),
      );
      return {
        checks: checkRows
          .filter((r) => r.status === 'finished' || r.status === 'partial')
          .map(checkFromRow),
        fixes,
        events: events.map(fixEventFromRow),
      };
    },

    async markDone(fixId, seatId) {
      const r = await admin.rpc(MARK_FIX_DONE_RPC, { p_fix: fixId, p_seat: seatId });
      if (r.error) throw new Error(`${MARK_FIX_DONE_RPC}: ${r.error.code} ${r.error.message}`);
      const a = MarkAnswer.parse(r.data);
      return a.outcome === 'marked' ? { outcome: 'marked', eventId: a.event_id, at: a.at } : a;
    },

    async requestEmail(req) {
      const id = randomUUID();
      const r = await admin.from('fix_email_requests').insert({
        id,
        fix_id: req.fixId,
        account_id: req.accountId,
        requested_by_seat_id: req.seatId,
        to_email: req.to,
      });
      if (r.error) throw new Error(`fixes-store: fix_email_requests insert: ${r.error.message}`);
      return id;
    },
  };
}
