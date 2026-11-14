import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyAllMigrations,
  freshDb,
  MIGRATIONS_DIR,
} from '../../apps/web/__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../apps/web/__tests__/helpers/postgrest-pglite';
import { supabaseEntitlementStore } from '../../apps/web/lib/billing/state-machine-apply';
import type { QaKey } from './accounts';
import type { QaAuth, SeedDeps } from './seed';
import { qaStore } from './store';

/**
 * The QA scripts' test world: PGlite with every migration (so `handle_new_user`, `add_site`, the
 * seat and trial functions are the real ones), the service-role PostgREST stand-in over it, and fakes
 * for what is not the database: Supabase Auth's admin API (it inserts into `auth.users`, so the
 * sign-up trigger runs), CC-33's `ops:internal`, the pipeline's event send and the trial's dispatch.
 * Test-only.
 */

/**
 * CC-33's migration adds `accounts.internal`. Until `origin/main` carries it (CC-38 questions Q1)
 * the tests that need the column are `todo`; they run as soon as the file is on the tree.
 */
export const HAS_INTERNAL_MARKER = existsSync(
  join(MIGRATIONS_DIR, '20261115000001_v2_033_operations.sql'),
);
const NEEDS_CC33 = 'needs accounts.internal from CC-33 (PR #83), not yet on origin/main';

/** `it` once CC-33's migration is on the tree; until then `it.todo`, its name carrying the reason. */
export function withMarker(name: string, fn: () => Promise<void>): void {
  if (HAS_INTERNAL_MARKER) it(name, fn);
  else it.todo(`${name} (${NEEDS_CC33})`);
}

/** A sample pepper, built from parts (the ledger needs 32 characters). */
export const SAMPLE_PEPPER = ['qa', 'seed', 'sample', 'pepper'].join('-').padEnd(40, 'x');

export interface World {
  db: PGlite;
  sb: SupabaseClient;
  deps: SeedDeps;
  /** Auth users the fake admin API made, by address. */
  users: Map<string, { id: string; qaKey: QaKey | null }>;
  sent: unknown[];
  /** While set, the pipeline's event send throws this message, as Inngest without its key does. */
  sendFails: { message: string | null };
  dispatched: unknown[];
  reports: { message: string; ctx: unknown }[];
  lines: string[];
  /** A user made by someone else, as a person signing up at a QA address would be. */
  signUp(email: string): Promise<string>;
}

export async function world(): Promise<World> {
  const db = await freshDb();
  await applyAllMigrations(db);
  const sb = postgrestOver(db);
  const users = new Map<string, { id: string; qaKey: QaKey | null }>();
  const sent: unknown[] = [];
  const sendFails: { message: string | null } = { message: null };
  const dispatched: unknown[] = [];
  const reports: { message: string; ctx: unknown }[] = [];
  const lines: string[] = [];

  const insertUser = async (email: string, qaKey: QaKey | null) => {
    const id = crypto.randomUUID();
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
    users.set(email, { id, qaKey });
    return id;
  };
  const auth: QaAuth = {
    async find(email) {
      const u = users.get(email);
      return u ? { id: u.id, qaKey: u.qaKey } : null;
    },
    create: (email, key) => insertUser(email, key),
  };

  const deps: SeedDeps = {
    auth,
    store: qaStore(sb, {
      send: async (event) => {
        if (sendFails.message !== null) throw new Error(sendFails.message);
        sent.push(event);
        return { ids: ['evt'] } as never;
      },
      admit: async () => true,
      trial: {
        entitlement: supabaseEntitlementStore(sb),
        admit: async () => true,
        report: (message, ctx) => reports.push({ message, ctx }),
        pepper: SAMPLE_PEPPER,
        now: () => new Date(),
        dispatch: async (planned) => {
          dispatched.push(...planned);
        },
      },
      now: () => new Date(),
    }),
    async markInternal(accountId) {
      // What CC-33's runInternal does: PATCH accounts set internal = true, by id.
      await db.query('update public.accounts set internal = true where id = $1', [accountId]);
    },
    inbox: { local: 'qa', domain: 'example.test' },
    print: (l) => lines.push(l),
  };
  return {
    db,
    sb,
    deps,
    users,
    sent,
    sendFails,
    dispatched,
    reports,
    lines,
    signUp: (e) => insertUser(e, null),
  };
}

/** Every row the seed can write, ordered, as text: the independent record a second run must leave. */
export async function dump(db: PGlite): Promise<string> {
  const tables = ['users', 'accounts', 'seats', 'sites', 'checks', 'qa_accounts', 'trial_ledger'];
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    const r = await db.query(`select * from public.${t} order by 1`);
    out[t] = r.rows;
  }
  return JSON.stringify(out);
}
