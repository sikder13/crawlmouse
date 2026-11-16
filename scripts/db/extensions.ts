import type { Db } from './db';

/**
 * Makes a dry-run branch's installed extensions match production's before the pending files are
 * applied. A Supabase branch can come up with extensions production does not have: on 2026-11-16
 * the branch for pull request 89 had pg_net (schema `net`, with PUBLIC grants on its tables) and
 * production did not, and check 10 failed on the branch for a reason production does not share.
 * The fingerprint cannot see this: it leaves extensions out (infra/supabase/checks/fingerprint.sql).
 *
 * Production is only read, with EXTENSIONS_SQL. On the branch, each extension production lacks is
 * dropped with a plain DROP EXTENSION, never CASCADE: Postgres then drops the extension's own
 * objects and refuses when anything else depends on them, and the refusal fails the step. An
 * extension production has and the branch lacks is created on the branch when it is on
 * CREATE_ON_BRANCH, and reported otherwise. pg_cron is on it: production has it, a new branch does
 * not, and migration 041's post-apply checks failed on production over `cron` tables the dry run
 * never saw (2026-11-16). A branch that refuses the create is logged and the run goes on, with the
 * extension still reported as missing.
 */

/** Extensions the dry run creates on its branch when production has them and the branch lacks them. */
export const CREATE_ON_BRANCH: readonly string[] = ['pg_cron'];

export const EXTENSIONS_SQL = 'select extname::text as name from pg_extension order by 1';

/** Which extension each installed extension requires, on the branch. */
const REQUIRES_SQL = `select e.extname::text as name, r.extname::text as requires
  from pg_depend d
  join pg_extension e on d.classid = 'pg_extension'::regclass and d.objid = e.oid
  join pg_extension r on d.refclassid = 'pg_extension'::regclass and d.refobjid = r.oid
 where d.deptype = 'n'`;

export async function readExtensions(db: Db): Promise<string[]> {
  return (await db.query<{ name: string }>(EXTENSIONS_SQL)).map((r) => r.name);
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

export interface Alignment {
  /** Dropped on the branch, in the order they were dropped. */
  dropped: string[];
  /** Created on the branch because production has them and they are on the allowlist. */
  created: string[];
  /** On the allowlist, and the branch refused to create them: name and Postgres's message. */
  refused: Array<{ name: string; error: string }>;
  /** Installed on production and not on the branch after the step. */
  missing: string[];
  /** The branch's extension set equals production's after the drops. */
  equal: boolean;
}

export async function alignExtensions(
  production: Db,
  branch: Db,
  log: (line: string) => void,
  createOnBranch: readonly string[] = CREATE_ON_BRANCH,
): Promise<Alignment> {
  const wanted = new Set(await readExtensions(production));
  const remaining = new Set(await readExtensions(branch));
  const dropped: string[] = [];
  for (;;) {
    const extra = [...remaining].filter((n) => !wanted.has(n)).sort();
    if (extra.length === 0) break;
    const requires = await branch.query<{ name: string; requires: string }>(REQUIRES_SQL);
    // An extension another installed one requires goes after that one.
    const next = extra.find(
      (n) => !requires.some((r) => r.requires === n && remaining.has(r.name) && r.name !== n),
    );
    if (next === undefined) {
      throw new Error(
        `cannot drop ${extra.join(', ')}: each is required by an extension that stays`,
      );
    }
    try {
      await branch.exec(`drop extension ${quoteIdent(next)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`could not drop extension ${next} on the branch: ${message}`);
    }
    log(`dropped extension ${next} (production does not have it)`);
    dropped.push(next);
    remaining.delete(next);
  }
  const created: string[] = [];
  const refused: Alignment['refused'] = [];
  for (const n of [...wanted].filter((w) => !remaining.has(w)).sort()) {
    if (!createOnBranch.includes(n)) continue;
    try {
      await branch.exec(`create extension if not exists ${quoteIdent(n)}`);
      log(`created extension ${n} on the branch (production has it)`);
      created.push(n);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log(`the branch refused to create extension ${n}: ${error}`);
      refused.push({ name: n, error });
    }
  }
  const after = new Set(await readExtensions(branch));
  const missing = [...wanted].filter((n) => !after.has(n)).sort();
  for (const n of missing)
    log(`production has extension ${n} and the branch does not; not installed`);
  const extraAfter = [...after].filter((n) => !wanted.has(n)).sort();
  return {
    dropped,
    created,
    refused,
    missing,
    equal: missing.length === 0 && extraAfter.length === 0,
  };
}

export function formatAlignment(a: Alignment): string {
  const differences =
    a.missing.length > 0 ? `missing on the branch: ${a.missing.join(', ')}` : 'none';
  const list = (names: string[]) => (names.length > 0 ? names.join(', ') : 'none');
  const refused =
    a.refused.length > 0
      ? `; the branch refused to create: ${list(a.refused.map((r) => r.name))}`
      : '';
  return `extensions equal to production after alignment: ${a.equal ? 'yes' : 'no'}, differences: ${differences}; dropped on the branch: ${list(a.dropped)}; created on the branch: ${list(a.created)}${refused}`;
}
