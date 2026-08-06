import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import type { FrontierOutcome, FrontierRecord, FrontierStore } from '@crawlmouse/engine';

/**
 * SPEC 5.1a §8 (Stage 6) — the SQL-backed FrontierStore.
 *
 * THIS ADAPTER IS DELIBERATELY THIN, AND THINNESS IS A CORRECTNESS PROPERTY HERE, not a style
 * preference. Every rule that could be got wrong lives in SQL (migrations 20260806000001/2), where
 * the integration tests execute it against a real Postgres. What is left here is argument marshalling.
 * The reason is the coverage boundary: nothing in the local suite can execute the supabase-js hop —
 * only the live smoke on the deployed function does — so anything expressed HERE rather than in SQL
 * would be a rule no test can reach.
 *
 * WHY THREE OF THE FOUR OPERATIONS ARE RPCs RATHER THAN QUERY-BUILDER CALLS:
 *   claim  — `FOR UPDATE SKIP LOCKED` has no PostgREST grammar at all.
 *   settle — must be ONE statement, or a partially-settled round moves the sample when the cap binds.
 *   upsert — PostgREST emits `SET col = excluded.col` per payload key, so a re-staged row carrying
 *            state:'discovered' would RESET a row already `fetched`. The SQL lowers depth via
 *            `least()` and never names `state`.
 * Only `allDiscovered` and `deleteAll` are plain table reads/writes, because both are expressible
 * without losing a guarantee.
 */
export function postgrestFrontierStore(sb: SupabaseClient, auditId: string): FrontierStore {
  return {
    async upsertDiscovered(records: FrontierRecord[]): Promise<void> {
      if (records.length === 0) return;
      const { error } = await sb.rpc('upsert_frontier_batch', {
        p_audit_id: auditId,
        p_url_hashes: records.map((r) => r.urlHash),
        p_urls: records.map((r) => r.url),
        p_template_keys: records.map((r) => r.templateKey),
        p_sample_keys: records.map((r) => r.sampleKey),
        p_depths: records.map((r) => r.depth),
        p_sources: records.map((r) => r.source),
      });
      if (error) throw error;
    },

    /**
     * PAGINATED, AND THAT IS LOAD-BEARING. PostgREST applies a server-side row ceiling and a default
     * range, so a single unbounded select would SILENTLY TRUNCATE the basis on any audit large enough
     * to matter — and a silently truncated basis is exactly the naive-resume defect B6 exists to
     * catch, arriving through the transport instead of through the algorithm. The loop runs until a
     * page comes back short.
     */
    async allDiscovered(): Promise<FrontierRecord[]> {
      const PAGE = 1000;
      const out: FrontierRecord[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb
          .from('frontier')
          .select('url_hash, url, template_key, sample_key, depth, state, source')
          .eq('audit_id', auditId)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as {
          url_hash: string; url: string; template_key: string;
          sample_key: string; depth: number; state: string; source: string;
        }[];
        for (const r of rows) {
          out.push({
            urlHash: r.url_hash,
            url: r.url,
            templateKey: r.template_key,
            sampleKey: r.sample_key,
            depth: r.depth,
            state: r.state as FrontierRecord['state'],
            source: r.source as FrontierRecord['source'],
          });
        }
        if (rows.length < PAGE) return out;
      }
    },

    async claim(urls: string[], limit: number): Promise<FrontierRecord[]> {
      if (urls.length === 0 || limit <= 0) return [];
      // The SQL keys on url_hash; the caller works in canonical URLs, so hash here rather than
      // widening the store interface. Kept identical to `frontierRecord`'s hashing by construction.
      const { data, error } = await sb.rpc('claim_frontier', {
        p_audit_id: auditId,
        p_url_hashes: urls.map(sha256Hex),
        p_limit: limit,
      });
      if (error) throw error;
      return ((data ?? []) as { url_hash: string; url: string; template_key: string;
        sample_key: string; depth: number; state: string; source: string }[]).map((r) => ({
        urlHash: r.url_hash,
        url: r.url,
        templateKey: r.template_key,
        sampleKey: r.sample_key,
        depth: r.depth,
        state: r.state as FrontierRecord['state'],
        source: r.source as FrontierRecord['source'],
      }));
    },

    async settleBatch(outcomes: FrontierOutcome[]): Promise<void> {
      if (outcomes.length === 0) return;
      const { error } = await sb.rpc('settle_frontier_batch', {
        p_audit_id: auditId,
        p_url_hashes: outcomes.map((o) => o.urlHash),
        p_states: outcomes.map((o) => o.state),
      });
      if (error) throw error;
    },

    async deleteAll(): Promise<void> {
      const { error } = await sb.from('frontier').delete().eq('audit_id', auditId);
      if (error) throw error;
    },
  };
}

/** sha256 hex of a canonical URL — the row key, matching `frontierRecord`'s `urlHash`. */
function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
