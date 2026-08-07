import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GUARD — the frontier RPC functions must never be EXECUTE-able by a client role.
 *
 * PostgREST publishes every function in the exposed schema at `/rest/v1/rpc/<name>`, and Postgres
 * grants EXECUTE on a NEW function to PUBLIC by default — of which `anon` and `authenticated` are
 * members. So the `REVOKE` in each migration is the only thing standing between a row-CLAIMING and a
 * row-DELETING endpoint and the open internet. The migration says so about itself; nothing enforced it.
 *
 * WHY A SOURCE GUARD RATHER THAN A LIVE CHECK. This repo already has the pattern twice
 * (`spec04-column-privilege-guard`, `spec05-pages-column-privilege-guard`), both written because a
 * bare REVOKE once shipped INERT here. The specific future hazard: `create or replace` preserves an
 * ACL only for an UNCHANGED signature. A later migration that adds a parameter creates a NEW function
 * that defaults to PUBLIC EXECUTE, while the existing revoke lines — which name the OLD signature —
 * silently do not cover it. A guard over the source catches that at review time; a live check would
 * only catch it after apply.
 */

const MIGRATIONS = resolve(__dirname, '../../../infra/supabase/migrations');

/** Every frontier function, with the exact signature its GRANT/REVOKE must name. */
const FUNCTIONS: [file: string, signature: string][] = [
  ['20260806000001_spec51a_stage6_frontier_functions.sql', 'public.claim_frontier(uuid, text[], integer)'],
  ['20260806000001_spec51a_stage6_frontier_functions.sql', 'public.delete_orphan_frontier_rows(integer)'],
  ['20260806000002_spec51a_stage6_settle_frontier_batch.sql', 'public.settle_frontier_batch(uuid, text[], text[])'],
  ['20260806000002_spec51a_stage6_settle_frontier_batch.sql', 'public.upsert_frontier_batch(uuid, text[], text[], text[], text[], integer[], text[])'],
];

const sql = (file: string): string => readFileSync(join(MIGRATIONS, file), 'utf8');

/**
 * The SQL with `--` comments removed. Load-bearing: these migrations explain at length WHY they are
 * `SECURITY INVOKER` and not DEFINER, so a naive scan of the raw file finds "security definer" in the
 * prose that exists to rule it out — the matcher would be reading the argument instead of the code.
 */
const code = (file: string): string =>
  sql(file).split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n').toLowerCase();

describe('GUARD — frontier RPC privilege posture, enforced from the migration source', () => {
  it('revokes EXECUTE from public, anon and authenticated for EVERY signature', () => {
    for (const [file, signature] of FUNCTIONS) {
      const revoke = `revoke execute on function ${signature} from public, anon, authenticated;`;
      expect(code(file), `${signature}: missing the exact revoke`).toContain(revoke.toLowerCase());
    }
  });

  it('grants EXECUTE to service_role ONLY — no other role appears in any grant', () => {
    for (const [file, signature] of FUNCTIONS) {
      const grant = `grant execute on function ${signature} to service_role;`;
      expect(code(file), `${signature}: missing the service_role grant`).toContain(grant.toLowerCase());
    }
    for (const file of new Set(FUNCTIONS.map(([f]) => f))) {
      const grants = code(file).match(/grant execute on function[^;]*;/g) ?? [];
      for (const g of grants) {
        // Only the GRANTEE clause — everything after the final ` to `. The signature itself contains
        // the schema qualifier `public.`, which a whole-statement match reads as the PUBLIC role.
        const grantee = g.slice(g.lastIndexOf(' to ') + 4).replace(';', '').trim();
        expect(grantee, 'a frontier function is granted to a non-service_role').toBe('service_role');
      }
    }
  });

  it('REVOKES BEFORE IT GRANTS — the order is the whole guarantee', () => {
    // A grant followed by a revoke would leave the function ungranted; a revoke that never ran leaves
    // the PUBLIC default in place. Only revoke-then-grant produces service_role-only.
    for (const [file, signature] of FUNCTIONS) {
      const body = code(file);
      const r = body.indexOf(`revoke execute on function ${signature.toLowerCase()}`);
      const g = body.indexOf(`grant execute on function ${signature.toLowerCase()}`);
      expect(r, `${signature}: no revoke`).toBeGreaterThan(-1);
      expect(g, `${signature}: no grant`).toBeGreaterThan(-1);
      expect(r, `${signature}: grant precedes revoke`).toBeLessThan(g);
    }
  });

  it('declares SECURITY INVOKER and pins search_path on every function', () => {
    for (const file of new Set(FUNCTIONS.map(([f]) => f))) {
      const body = code(file);
      expect(body, `${file}: a SECURITY DEFINER function would run as the owner`).not.toContain('security definer');
      const creates = (body.match(/create or replace function/g) ?? []).length;
      expect((body.match(/security invoker/g) ?? []).length, `${file}: every function must declare INVOKER`).toBe(creates);
      expect((body.match(/set search_path = public, pg_catalog/g) ?? []).length).toBe(creates);
    }
  });

  it('covers EVERY function the migrations define — the list cannot silently fall behind', () => {
    // Anti-staleness: a new function added to either file without a guard entry fails here, which is
    // the fourteenth-surface problem applied to SQL.
    for (const file of new Set(FUNCTIONS.map(([f]) => f))) {
      const defined = (code(file).match(/create or replace function\s+(public\.\w+)/g) ?? [])
        .map((m) => m.split(/\s+/).pop()!.toLowerCase());
      const guarded = FUNCTIONS.filter(([f]) => f === file).map(([, s]) => s.split('(')[0]!.toLowerCase());
      for (const d of defined) expect(guarded, `${d} is defined but not guarded`).toContain(d);
    }
  });
});
