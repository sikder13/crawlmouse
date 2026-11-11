/**
 * A database for the fix routes' tests: every migration on PGlite, an account (seedWorld: an owner,
 * a developer seat scoped to site1, two sites each with a finished check) and a second account, the
 * stranger. Site1 gets five open fixes of its check, ranked 1 to 5 with no events, so Free opens the
 * first three and not the last two (view/free-fixes.ts). The fix seedWorld itself seeds carries a
 * `verified` event, so the visibility rule counts it as resolved.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applyAllMigrations, freshDb } from '../../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../../__tests__/helpers/postgrest-pglite';
import { fixture } from '../../fixtures';
import {
  insertRow,
  ROWS,
  seedWorld,
  type World,
} from '../../../../__tests__/helpers/v2-check-tables';

const EFFECT = fixture('bad-site').fixes[0]!.effect;
const CHECK = fixture('bad-site').checks.find((c) => c.status === 'finished')!;
const MEASURED = [
  'grade_version',
  'tested_at',
  'coverage',
  'technical_seo',
  'ai_readability',
  'structure',
  'without_js',
  'content',
  'signals',
  'crawlers',
  'stack',
  'competitors',
] as const;

export interface FixWorld {
  db: PGlite;
  w: World;
  stranger: World;
  /** Site1's fixes, by rank: Free opens [0], [1] and [2]. */
  ranked: string[];
  /** The check that first found them. */
  checkId: string;
}

export async function fixWorld(): Promise<FixWorld> {
  const db = await freshDb();
  await applyAllMigrations(db);
  const w = await seedWorld(db, 'fixroutes');
  const stranger = await seedWorld(db, 'stranger');
  const checkId = w.seeded.checks.find((r) => r.scope === 'site1')!.pk.id as string;
  const ranked: string[] = [];
  for (let rank = 1; rank <= 5; rank++) {
    const id = randomUUID();
    await insertRow(db, 'site_fixes', {
      ...ROWS.site_fixes(id, w.site1, checkId, 5000 + rank),
      rank,
      packet: null,
    });
    ranked.push(id);
  }
  // ROWS predates the contract's current effect and check shapes, and the routes parse every fix and
  // check row of a site: both take a fixture's values.
  await db.query(`update public.site_fixes set effect = $1::jsonb`, [JSON.stringify(EFFECT)]);
  await db.query(
    `update public.checks c set ${MEASURED.map((k) => `${k} = r.${k}`).join(', ')}
       from jsonb_populate_record(null::public.checks, $1::jsonb) r
      where c.status in ('finished', 'partial')`,
    [JSON.stringify(CHECK)],
  );
  return { db, w, stranger, ranked, checkId };
}

/** Moves `accountId` to Pro, as the billing state machine leaves a paid account. */
export async function makePro(db: PGlite, accountId: string): Promise<void> {
  await db.query(
    `update public.accounts set state = 'pro', tier = 'pro', site_limit = 5, seat_limit = 2,
       competitor_limit = 1, current_subscription_id = 'sub_026b_fixes',
       state_history = state_history || jsonb_build_array(jsonb_build_object('state', 'pro', 'since', now()::text))
     where id = $1`,
    [accountId],
  );
}

/** The two clients a route makes: the caller's session (with `auth.getUser`) and the service role. */
export function clients(db: PGlite, userId: string | null) {
  const session = (
    userId === null ? postgrestOver(db) : postgrestOver(db, { as: { userId } })
  ) as SupabaseClient & {
    auth: unknown;
  };
  Object.assign(session, {
    auth: {
      getUser: async () => ({
        data: { user: userId === null ? null : { id: userId } },
        error: null,
      }),
    },
  });
  return { session: session as SupabaseClient, admin: postgrestOver(db) };
}
