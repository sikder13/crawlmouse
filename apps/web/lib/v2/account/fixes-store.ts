/**
 * The fix routes' service-role reads and their one write (CC-26b D5, D9). A route makes this store
 * only after the caller's own session has answered `is_member_for_fix` for the fix: `site_fixes` and
 * `fix_events` have no client grant, so these reads cannot be made with the caller's client.
 *
 * The one write is `mark_fix_done` (migration 20261112000001), which sets the status and appends its
 * `fix_events` row in one transaction. The one-writer guard in lib/v2/pipeline/persist.test.ts holds
 * this file to that function.
 */
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Check, Fix, FixEvent } from '@crawlmouse/types/v2';
import { z } from 'zod';
import { checkFromRow, fixEventFromRow, fixFromRow } from '../pipeline/rows';

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
}

function rows(what: string, r: { data: unknown; error: PostgrestError | null }) {
  if (r.error) throw new Error(`fixes-store: ${what}: ${r.error.code} ${r.error.message}`);
  return (r.data ?? []) as Record<string, unknown>[];
}

export function supabaseFixesStore(admin: SupabaseClient): FixesStore {
  return {
    async fix(fixId) {
      const [row] = rows(
        'site_fixes read',
        await admin.from('site_fixes').select('*').eq('id', fixId).limit(1),
      );
      return row ? fixFromRow(row) : null;
    },

    async siteFixes(siteId) {
      const [checks, fixes] = await Promise.all([
        admin
          .from('checks')
          .select('*')
          .eq('site_id', siteId)
          .in('status', ['finished', 'partial']),
        admin.from('site_fixes').select('*').eq('site_id', siteId),
      ]);
      const fixRows = rows('site_fixes read', fixes).map(fixFromRow);
      const events =
        fixRows.length === 0
          ? []
          : rows(
              'fix_events read',
              await admin
                .from('fix_events')
                .select('*')
                .in(
                  'fix_id',
                  fixRows.map((f) => f.id),
                ),
            ).map(fixEventFromRow);
      return { checks: rows('checks read', checks).map(checkFromRow), fixes: fixRows, events };
    },

    async markDone(fixId, seatId) {
      const r = await admin.rpc(MARK_FIX_DONE_RPC, { p_fix: fixId, p_seat: seatId });
      if (r.error) throw new Error(`${MARK_FIX_DONE_RPC}: ${r.error.code} ${r.error.message}`);
      const a = MarkAnswer.parse(r.data);
      return a.outcome === 'marked' ? { outcome: 'marked', eventId: a.event_id, at: a.at } : a;
    },
  };
}
