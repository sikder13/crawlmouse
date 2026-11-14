import type { PGlite } from '@electric-sql/pglite';
import { it, type TestContext } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applyAllMigrations, freshDb } from '../../apps/web/__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../apps/web/__tests__/helpers/postgrest-pglite';
import { supabaseEntitlementStore } from '../../apps/web/lib/billing/state-machine-apply';
import type { QaKey } from './accounts';
import { migrationsAddInternal } from './marker-gate';
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
 * Whether a migration adds `accounts.internal` (./marker-gate.ts). Until `origin/main` carries one
 * (CC-38 questions Q1) the tests that need the column are `todo`; they run as soon as one is on the
 * tree, whatever its file is called.
 */
export const HAS_INTERNAL_MARKER = migrationsAddInternal();
const NEEDS_CC33 = 'needs accounts.internal from CC-33 (PR #83), not yet on origin/main';

/** The time a PGlite test may take: each builds a database with every migration, 5-7 s under load. */
export const PGLITE_TIMEOUT = 60_000;

/**
 * `it` once a migration adds `accounts.internal`; until then `it.todo`, its name carrying the reason.
 * The timeout is required: vitest's 5 s default is shorter than a seeded PGlite test under load.
 */
export function withMarker(
  name: string,
  fn: (ctx: TestContext) => Promise<void>,
  timeout: number,
): void {
  if (HAS_INTERNAL_MARKER) it(name, fn, timeout);
  else it.todo(`${name} (${NEEDS_CC33})`);
}

/**
 * Every migration applied once, for a file's `beforeAll`: each test then takes a `clone()` of it, so
 * no two tests share rows and none pays for the migrations again.
 */
export async function migratedBase(): Promise<PGlite> {
  const db = await freshDb();
  await applyAllMigrations(db);
  return db;
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
  /** The prompts the seed asked; the fake answers each with the phrase it names, unless `answer`. */
  asked: string[];
  answer: { typed: string | null };
  /** A user made by someone else, as a person signing up at a QA address would be. */
  signUp(email: string): Promise<string>;
}

/** The world over a clone of `base` (see `migratedBase`), or over a database built here. */
export async function world(base?: PGlite): Promise<World> {
  const db = base ? ((await base.clone()) as PGlite) : await migratedBase();
  const sb = postgrestOver(db);
  const users = new Map<string, { id: string; qaKey: QaKey | null }>();
  const sent: unknown[] = [];
  const sendFails: { message: string | null } = { message: null };
  const dispatched: unknown[] = [];
  const reports: { message: string; ctx: unknown }[] = [];
  const lines: string[] = [];
  const asked: string[] = [];
  const answer: { typed: string | null } = { typed: null };

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
      paused: () => false,
    }),
    async markInternal(accountId) {
      // What CC-33's runInternal does: PATCH accounts set internal = true, by id.
      await db.query('update public.accounts set internal = true where id = $1', [accountId]);
    },
    inbox: { local: 'qa', domain: 'example.test' },
    async confirm(prompt) {
      asked.push(prompt);
      lines.push('<asked>');
      return answer.typed ?? /"([^"]+)"/.exec(prompt)?.[1] ?? '';
    },
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
    asked,
    answer,
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
