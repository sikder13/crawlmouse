import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { Db, Row } from './db';

/**
 * Test support only: a PGlite database behind the scripts' `Db` interface. `executed` records every
 * text sent to the database, so a test can assert what a script ran.
 */
export interface RecordingDb extends Db {
  executed: string[];
  pglite: PGlite;
}

type Target = PGlite | Transaction;

function adapter(target: Target, executed: string[], root: PGlite): RecordingDb {
  return {
    executed,
    pglite: root,
    async query<T extends Row>(text: string, params: readonly unknown[] = []) {
      executed.push(text);
      return (await target.query<T>(text, [...params])).rows;
    },
    async exec(text: string) {
      executed.push(text);
      await target.exec(text);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      if (!('transaction' in target)) throw new Error('nested transactions are not used');
      return target.transaction((tx) => fn(adapter(tx, executed, root)));
    },
    close: async () => {},
  };
}

export function pgliteDb(pglite: PGlite): RecordingDb {
  return adapter(pglite, [], pglite);
}

/** Runs `fn` inside a transaction that is always rolled back, so a mutation never outlives a test. */
export async function withRollback<T>(pglite: PGlite, fn: (db: Db) => Promise<T>): Promise<T> {
  let result: T | undefined;
  await pglite.transaction(async (tx) => {
    result = await fn(adapter(tx, [], pglite));
    await tx.rollback();
  });
  return result as T;
}

/** A PGlite database with the Supabase stand-ins and the repository's migrations applied. */
export async function migratedDb(include?: (file: string) => boolean): Promise<PGlite> {
  const { applyAllMigrations, freshDb } =
    await import('../../apps/web/__tests__/helpers/pglite-migrations');
  const pglite = await freshDb();
  await applyAllMigrations(pglite, undefined, include);
  return pglite;
}

/** The history table as production has it (columns read from ezspnfeyzwsisymytssm on 2026-11-05). */
export const HISTORY_TABLE = `
  create schema if not exists supabase_migrations;
  create table supabase_migrations.schema_migrations (
    version text primary key,
    statements text[],
    name text,
    created_by text,
    idempotency_key text,
    rollback text[]
  );
`;

/**
 * The name of one existing partition of a table (`public_page_results`, `research_check_runs`, ...).
 * Partitions are created for the months around now(), so a test names none of them literally.
 */
export async function partitionOf(pglite: PGlite, parent: string): Promise<string> {
  const { rows } = await pglite.query<{ relname: string }>(
    `select relname from pg_class
      where relnamespace = 'partitions'::regnamespace and relname ~ $1
      order by relname limit 1`,
    [`^${parent}_[0-9]{4}_[0-9]{2}$`],
  );
  if (!rows[0]) throw new Error(`no partition of ${parent}`);
  return rows[0].relname;
}
