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

/**
 * A function this guard governs.
 *
 * GATE 5 / R2-NB1 + R3-NB2. This was `name.includes('frontier')` while commit `5383ac2` described it
 * as *"selected by what they operate on, not by a list"* — which was FALSE. A name match is a list
 * with one entry, spelled as a convention. Demonstrated by both reviewers: a new
 * `create or replace function public.reap_stale_urls(integer) … security definer` whose body is
 * `delete from public.frontier …`, with no revoke, passed all seven tests. That is gate 4's evasion 6
 * with a smaller radius — the guard stopped carrying its own file list and started carrying its own
 * naming convention.
 *
 * Now it genuinely is the operation: a function is governed if it TOUCHES the frontier tables,
 * whatever it is called. The name check is kept as an OR so a frontier function that happens not to
 * name the table in its body (a wrapper, a trigger shim) is still covered.
 */
const GOVERNED_TABLES = ['public.frontier', 'public.frontier_politeness'];

const isFrontierFn = (name: string, body: string): boolean =>
  name.includes('frontier') || GOVERNED_TABLES.some((t) => body.includes(t));

interface DefinedFn {
  file: string;
  /** `public.claim_frontier` */
  name: string;
  /** `public.claim_frontier(uuid, text[], integer)` — the signature a GRANT/REVOKE must name. */
  signature: string;
  /** The function body, so governance is decided by what it touches rather than what it is called. */
  body: string;
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
    // The `$$ … $$` body is captured too, so governance can be decided by what a function TOUCHES
    // rather than by what it is called.
    for (const m of body.matchAll(/create (?:or replace )?function (public\.\w+|\w+) ?\(([^)]*)\)([^;]*?\$\$.*?\$\$)?/g)) {
      const name = m[1]!;
      const args = m[2]!.trim();
      const fnBody = m[3] ?? '';
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
      out.push({ file, name, signature: `${name}(${types})`, body: fnBody });
    }
  }
  return out;
}

const frontierFns = (): DefinedFn[] => definedFunctions().filter((f) => isFrontierFn(f.name, f.body));

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
      // `ALL ROUTINES` is valid from PG 11 and grants exactly the same thing (gate 5 / R2-A) — a
      // direct sibling of the closed evasion 1 and just as idiomatic in Supabase snippets.
      for (const g of code(file).match(/grant (?:execute|all)[^;]*on all (?:functions|routines) in schema[^;]*;/g) ?? []) {
        expect(g, `${file}: a schema-wide function grant`).not.toMatch(/\b(anon|authenticated|public)\b/);
      }
    }
  });

  it('NO migration grants a frontier function to anything but service_role, by any grant form', () => {
    // Evasions 1 and 2 at the per-function level: GRANT ALL confers EXECUTE, so both verbs are read.
    for (const file of migrationFiles()) {
      for (const g of code(file).match(/grant (?:execute|all)(?: privileges)? on function[^;]*;/g) ?? []) {
        // Matched on the BARE name as well as the qualified one: `grant execute on function
        // claim_frontier(uuid, text[], integer) to anon;` resolves through `search_path` (= public in
        // a Supabase migration) and is a real grant on the live function — gate 5 / R2-B and R3-EV7,
        // which is evasion 2 reopened by a spelling change.
        const named = frontierFns().some((f) => g.includes(f.name) || g.includes(f.name.replace('public.', '')));
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

  it('NO migration pre-grants EXECUTE to a client role via ALTER DEFAULT PRIVILEGES', () => {
    // Gate 5 / R2-D and R3-EV9. This grants EXECUTE on every function created AFTERWARDS, so it
    // touches nothing today and everything tomorrow — precisely the hazard a SOURCE guard exists to
    // catch, since a live check would only see it after the next function is applied.
    for (const file of migrationFiles()) {
      for (const g of code(file).match(/alter default privileges[^;]*;/g) ?? []) {
        expect(g, `${file}: default privileges pre-grant to a client role`).not.toMatch(/\b(anon|authenticated|public)\b/);
      }
    }
  });

  it('NO migration weakens a governed function through ALTER FUNCTION', () => {
    // Gate 5 / R2-C and R2-G. Only `create … function` bodies were scanned, so `alter function
    // public.claim_frontier(…) security definer;` — or `… reset search_path;` — in a NEW file was
    // never read at all: the posture assertions iterate files that DEFINE a governed function.
    for (const file of migrationFiles()) {
      for (const a of code(file).match(/alter function[^;]*;/g) ?? []) {
        const governed = frontierFns().some((f) => a.includes(f.name) || a.includes(f.name.replace('public.', '')));
        if (!governed) continue;
        expect(a, `${file}: ALTER FUNCTION makes a governed function SECURITY DEFINER`).not.toContain('security definer');
        expect(a, `${file}: ALTER FUNCTION unpins the search_path`).not.toContain('reset search_path');
      }
    }
  });

  it('NO migration grants the frontier TABLES to a client role', () => {
    // Gate 5 / R2-F. Mitigated in fact — RLS is on with zero policies — but defence in depth is the
    // point of a privilege guard, and a table grant is a different statement from a function grant, so
    // nothing above would have seen it.
    for (const file of migrationFiles()) {
      for (const g of code(file).match(/grant [^;]*on (?:table )?public\.frontier[^;]*;/g) ?? []) {
        const grantee = g.slice(g.lastIndexOf(' to ') + 4).replace(';', '').trim();
        expect(grantee, `${file}: a frontier TABLE is granted to ${grantee}`).not.toMatch(/\b(anon|authenticated|public)\b/);
      }
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
