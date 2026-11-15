import type { PGlite } from '@electric-sql/pglite';
import { it, type TestContext } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applyAllMigrations, freshDb } from '../../apps/web/__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../apps/web/__tests__/helpers/postgrest-pglite';
import { supabaseEntitlementStore } from '../../apps/web/lib/billing/state-machine-apply';
import type { QaKey } from './accounts';
import { migrationsAddInternal } from './marker-gate';
import type { QaAuth, SeedDeps } from './seed';
import { runInternal } from '../ops/internal';
import { restClient } from '../ops/supabase-rest';
import { qaStore } from './store';

/**
 * The QA scripts' test world: PGlite with every migration (so `handle_new_user`, `add_site`, the
 * seat and trial functions are the real ones), the service-role PostgREST stand-in over it, and fakes
 * for what is not the database: Supabase Auth's admin API (it inserts into `auth.users`, so the
 * sign-up trigger runs), CC-33's `ops:internal`, the pipeline's event send and the trial's dispatch.
 * Test-only.
 */

/**
 * The tests below need `accounts.internal` (CC-33's migration, on the tree since the CC-33 merge). Its
 * absence is a failure, not a reason to skip: a renamed or reverted migration turns these red.
 */
if (!migrationsAddInternal()) {
  throw new Error(
    'no migration adds accounts.internal: CC-33 (20261115000001) is missing from the tree',
  );
}

/** The time a PGlite test may take: each builds a database with every migration, 5-7 s under load. */
export const PGLITE_TIMEOUT = 60_000;

/**
 * `it` for a test over PGlite with every migration. The timeout is required: vitest's 5 s default is
 * shorter than a seeded PGlite test under load.
 */
export function pgliteTest(
  name: string,
  fn: (ctx: TestContext) => Promise<void>,
  timeout: number,
): void {
  it(name, fn, timeout);
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
  /** Turns CRAWL_PAUSED on or off for the store's next calls. */
  pause(on: boolean): void;
}

/** The world over a clone of `base` (see `migratedBase`), or over a database built here. */
export async function world(base?: PGlite): Promise<World> {
  let pausedNow = false;
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
      // CRAWL_PAUSED as the operator's shell holds it; a test turns it on through `world.pause`.
      paused: () => pausedNow,
    }),
    // CC-33's ops:internal module itself, over its REST client, answered by the PostgREST stand-in.
    markInternal: (accountId) =>
      runInternal(
        [accountId],
        restClient({ url: 'http://pglite', key: 'service', fetch: pgliteFetch(sb) }),
        () => {},
      ),
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
    pause: (on: boolean) => {
      pausedNow = on;
    },
  };
}

/**
 * A `fetch` for CC-33's REST client (scripts/ops/supabase-rest.ts) answered by the PostgREST stand-in
 * over PGlite: `PATCH /rest/v1/<table>?<col>=eq.<v>&select=<cols>` with `return=representation`, the one
 * request `runInternal` makes. Anything else is refused, so a new request shows here first.
 */
function pgliteFetch(sb: SupabaseClient) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const table = url.pathname.replace('/rest/v1/', '');
    if (init?.method !== 'PATCH') throw new Error(`pgliteFetch: ${init?.method} is not modelled`);
    let q = sb.from(table).update(JSON.parse(String(init.body)));
    for (const [k, v] of url.searchParams) {
      if (k === 'select') continue;
      if (!v.startsWith('eq.')) throw new Error(`pgliteFetch: filter ${k}=${v} is not modelled`);
      q = q.eq(k, v.slice(3));
    }
    const { data, error } = await q.select(url.searchParams.get('select') ?? '*');
    if (error) return new Response(JSON.stringify(error), { status: 400 });
    return new Response(JSON.stringify(data), { status: 200 });
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
