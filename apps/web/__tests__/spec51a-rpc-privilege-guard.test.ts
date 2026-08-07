import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GUARD — the frontier RPC functions must never be EXECUTE-able by a client role.
 *
 * PostgREST publishes every function in the exposed schema at `/rest/v1/rpc/<name>`, and Postgres
 * grants EXECUTE on a NEW function to PUBLIC by default — of which `anon` and `authenticated` are
 * members. So the `REVOKE` in each migration is the only thing standing between a row-CLAIMING and a
 * row-DELETING endpoint and the open internet.
 *
 * GATE 4 REWROTE THIS FILE. Its first version passed SIX unsafe migrations, each verified by running
 * the shipped test against a mutated copy, with two controls confirming the harness itself worked:
 *
 *   1. `grant execute on all functions in schema public to anon, authenticated;` — the grantee scan
 *      matched `grant execute on function`, never the schema-wide form. This is a COMMON Supabase
 *      convenience idiom, which makes it the likeliest of the six to actually be typed.
 *   2. `grant all on function … to anon;` — GRANT ALL confers EXECUTE; only `grant execute` was read.
 *   3. a new function via plain `create function` (no `or replace`) — the staleness scan and both
 *      posture counts keyed on `create or replace function`, so the function was invisible.
 *   4. a revoke wrapped in `/* … *​/` — only `--` comments were stripped, so a commented-out revoke
 *      still satisfied a `toContain`. That is VERBATIM the "bare REVOKE shipped INERT" failure this
 *      file's own header cites as its reason for existing.
 *   5. `security` and `definer` split across a newline — matched as a single-line string.
 *   6. it read only the two files hardcoded in its own list, and its "anti-staleness" test iterated
 *      that same list. Demonstrated: a NEW migration re-creating `claim_frontier` as
 *      `security definer` with no revoke passed all five tests silently — verbatim the future hazard
 *      the header names.
 *
 * So: every `.sql` in the directory is read, comments of BOTH kinds are stripped, whitespace is
 * collapsed before matching, and the function inventory is DERIVED FROM THE SQL rather than restated
 * here. A guard that carries its own copy of the inventory is the SPEC 05 barrel-guard failure, and
 * evasion 6 is that failure happening again in a file written to prevent this class.
 */

const MIGRATIONS = resolve(__dirname, '../../../infra/supabase/migrations');

const migrationFiles = (): string[] => readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

/**
 * Migration SQL, lowercased, with BOTH comment forms removed and all whitespace collapsed.
 *
 * Comment stripping is load-bearing in both directions. These migrations explain at length WHY they
 * are `SECURITY INVOKER` and not DEFINER, so a naive scan finds "security definer" in the prose that
 * exists to rule it out — reading the argument instead of the code. And a revoke inside a block
 * comment does not run, so a matcher that cannot see block comments will accept a dead revoke.
 *
 * Whitespace collapse closes evasion 5: `security\ndefiner` and `security  definer` are the same
 * declaration to Postgres and must be the same string here.
 */
const code = (file: string): string =>
  readFileSync(join(MIGRATIONS, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => (l.trimStart().startsWith('--') ? '' : l))
    .join('\n')
    .toLowerCase()
    .replace(/\s+/g, ' ');

/** A function this guard governs: anything frontier-related, matched on the OPERATION not a list. */
const isFrontierFn = (name: string): boolean => name.includes('frontier');

interface DefinedFn {
  file: string;
  /** `public.claim_frontier` */
  name: string;
  /** `public.claim_frontier(uuid, text[], integer)` — the signature a GRANT/REVOKE must name. */
  signature: string;
}

/**
 * Every function any migration defines, derived from the SQL. `or replace` is OPTIONAL in the match
 * (evasion 3): a plain `create function` defines a function just as thoroughly, and defaults to
 * PUBLIC EXECUTE just as thoroughly.
 */
function definedFunctions(): DefinedFn[] {
  const out: DefinedFn[] = [];
  for (const file of migrationFiles()) {
    const body = code(file);
    for (const m of body.matchAll(/create (?:or replace )?function (public\.\w+|\w+) ?\(([^)]*)\)/g)) {
      const name = m[1]!;
      const args = m[2]!.trim();
      // Reduce the parameter list to the TYPE list a GRANT/REVOKE must name — which is what Postgres
      // identifies a function by. Argument names go, and so do DEFAULT clauses: a signature is
      // `delete_orphan_frontier_rows(integer)`, never `(integer default 500)`. Multi-word types
      // (`double precision`, `timestamp with time zone`) survive because only the leading NAME token
      // is dropped, not everything but the last.
      const types = args
        ? args
            .split(',')
            .map((a) => {
              const noDefault = a.split(' default ')[0]!.trim();
              return noDefault.split(/\s+/).slice(1).join(' ') || noDefault;
            })
            .join(', ')
        : '';
      out.push({ file, name, signature: `${name}(${types})` });
    }
  }
  return out;
}

const frontierFns = (): DefinedFn[] => definedFunctions().filter((f) => isFrontierFn(f.name));

describe('GUARD — frontier RPC privilege posture, enforced from every migration', () => {
  it('finds the frontier functions at all — anti-vacuity for every rule below', () => {
    // If the derivation broke, every "for each function" assertion would pass over an empty list and
    // this file would police nothing in perfect silence. Evasion 6 is exactly that failure mode.
    expect(migrationFiles().length).toBeGreaterThan(30);
    const names = frontierFns().map((f) => f.name).sort();
    expect(names).toEqual([
      'public.claim_frontier',
      'public.delete_orphan_frontier_rows',
      'public.settle_frontier_batch',
      'public.upsert_frontier_batch',
    ]);
  });

  it('NO migration grants function EXECUTE schema-wide to a client role', () => {
    // Evasion 1. `grant execute on all functions in schema public to anon` re-grants every frontier
    // function in one line, from any file, at any future date — and it is a common Supabase idiom.
    for (const file of migrationFiles()) {
      for (const g of code(file).match(/grant (?:execute|all)[^;]*on all functions in schema[^;]*;/g) ?? []) {
        expect(g, `${file}: a schema-wide function grant`).not.toMatch(/\b(anon|authenticated|public)\b/);
      }
    }
  });

  it('NO migration grants a frontier function to anything but service_role, by any grant form', () => {
    // Evasions 1 and 2 at the per-function level: GRANT ALL confers EXECUTE, so both verbs are read.
    for (const file of migrationFiles()) {
      for (const g of code(file).match(/grant (?:execute|all)(?: privileges)? on function[^;]*;/g) ?? []) {
        const named = frontierFns().some((f) => g.includes(f.name));
        if (!named) continue;
        // Only the GRANTEE clause — everything after the final ` to `. The signature itself contains
        // the schema qualifier `public.`, which a whole-statement match reads as the PUBLIC role.
        const grantee = g.slice(g.lastIndexOf(' to ') + 4).replace(';', '').trim();
        expect(grantee, `${file}: a frontier function is granted to ${grantee}`).toBe('service_role');
      }
    }
  });

  it('revokes EXECUTE from public, anon and authenticated for EVERY frontier signature', () => {
    for (const { file, signature } of frontierFns()) {
      const revoke = `revoke execute on function ${signature} from public, anon, authenticated;`;
      expect(code(file), `${signature}: missing the exact revoke`).toContain(revoke);
    }
  });

  it('REVOKES BEFORE IT GRANTS — the order is the whole guarantee', () => {
    // A grant followed by a revoke leaves the function ungranted; a revoke that never ran leaves the
    // PUBLIC default in place. Only revoke-then-grant produces service_role-only.
    for (const { file, signature } of frontierFns()) {
      const body = code(file);
      const r = body.indexOf(`revoke execute on function ${signature}`);
      const g = body.indexOf(`grant execute on function ${signature}`);
      expect(r, `${signature}: no revoke`).toBeGreaterThan(-1);
      expect(g, `${signature}: no grant`).toBeGreaterThan(-1);
      expect(r, `${signature}: grant precedes revoke`).toBeLessThan(g);
    }
  });

  it('declares SECURITY INVOKER and pins search_path on every frontier function', () => {
    for (const file of new Set(frontierFns().map((f) => f.file))) {
      const body = code(file);
      expect(body, `${file}: a SECURITY DEFINER function would run as the owner`).not.toContain('security definer');
      const defined = frontierFns().filter((f) => f.file === file).length;
      expect((body.match(/security invoker/g) ?? []).length, `${file}: every function must declare INVOKER`).toBe(defined);
      expect((body.match(/set search_path = public, pg_catalog/g) ?? []).length).toBe(defined);
    }
  });

  it('reads through block comments — a commented-out revoke does not count as a revoke', () => {
    // Evasion 4, asserted directly rather than left to the rules above: the stripper must be the
    // reason a `/* … */` revoke fails, so a future refactor of `code()` that loses block-comment
    // handling fails HERE, with a message naming the cause.
    const withBlockComment = '/* revoke execute on function public.claim_frontier(uuid) from public; */ select 1;';
    const stripped = withBlockComment.replace(/\/\*[\s\S]*?\*\//g, ' ').toLowerCase();
    expect(stripped).not.toContain('revoke');
  });
});
