/**
 * The ledger writer's reads and writes, over a service-role client (CC-41 D4). Single selects by key,
 * the `is_internal_subject` and `record_check_ledger` functions, and the draft row's insert and
 * delete. Every error throws: the writer's caller reports it and the backfill retries once.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LedgerDraft, Observation } from './draft';
import type { LedgerRun, LedgerSource, LedgerStore } from './write';

function must<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`ledger: ${what}: ${r.error.message}`);
  return r.data;
}

export function supabaseLedgerStore(sb: SupabaseClient): LedgerStore {
  return {
    async source(checkId): Promise<LedgerSource | null> {
      const check = must(
        await sb
          .from('checks')
          .select('status, lineage_id, check_month, site_id')
          .eq('id', checkId)
          .maybeSingle(),
        'read check',
      ) as {
        status: string;
        lineage_id: string | null;
        check_month: string;
        site_id: string;
      } | null;
      if (check === null) return null;
      const site = must(
        await sb.from('sites').select('host, account_id').eq('id', check.site_id).maybeSingle(),
        'read site',
      ) as { host: string; account_id: string | null } | null;
      if (site === null) return null;
      const link = must(
        await sb.from('check_ledger_links').select('run_id').eq('check_id', checkId).limit(1),
        'read link',
      ) as unknown[];
      const draft = must(
        await sb.from('check_ledger_drafts').select('draft').eq('check_id', checkId).maybeSingle(),
        'read draft',
      ) as { draft: unknown } | null;
      return {
        status: check.status,
        lineageId: check.lineage_id,
        month: check.check_month,
        host: site.host,
        accountId: site.account_id,
        linked: link.length > 0,
        draft: draft?.draft ?? null,
      };
    },

    async internal(accountId) {
      const data = must(
        await sb.rpc('is_internal_subject', { p_kind: 'account', p_id: accountId }),
        'internal lookup',
      );
      if (typeof data !== 'boolean') throw new Error('ledger: internal lookup: not a boolean');
      return data;
    },

    async record(checkId, run: LedgerRun, observations: readonly Observation[]) {
      must(
        await sb.rpc('record_check_ledger', {
          p_check_id: checkId,
          p_run: run,
          p_observations: observations,
        }),
        'record',
      );
    },

    async dropDraft(checkId) {
      must(await sb.from('check_ledger_drafts').delete().eq('check_id', checkId), 'drop draft');
    },

    async draftedBetween(from, to, limit) {
      const rows = must(
        await sb
          .from('check_ledger_drafts')
          .select('check_id')
          .gte('created_at', from.toISOString())
          .lt('created_at', to.toISOString())
          .order('created_at', { ascending: true })
          .limit(limit),
        'list drafts',
      ) as { check_id: string }[];
      return rows.map((r) => r.check_id);
    },
  };
}

/** The build step's one write: a check's draft, once (a repeated build leaves the first). */
export async function putLedgerDraft(
  sb: SupabaseClient,
  checkId: string,
  draft: LedgerDraft,
): Promise<void> {
  must(
    await sb
      .from('check_ledger_drafts')
      .upsert({ check_id: checkId, draft }, { onConflict: 'check_id', ignoreDuplicates: true }),
    'store draft',
  );
}
