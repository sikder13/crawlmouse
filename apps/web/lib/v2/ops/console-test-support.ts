/**
 * Test support for the support console's routes and pages: an operator over a migrated PGlite, and
 * the record's rows. The clients are the site routes' stand-ins (`sites-test-support.ts`).
 */
import type { PGlite } from '@electric-sql/pglite';
import { person, type Person } from '../account/sites-test-support';

/** A signed-up person who is also an operator. */
export async function operatorPerson(db: PGlite): Promise<Person> {
  const p = await person(db, 'operator');
  await db.query('insert into public.operators (user_id) values ($1)', [p.id]);
  return p;
}

export interface ActionLine {
  operator_id: string;
  action: string;
  account_id: string | null;
  target: string | null;
  reason: string | null;
  outcome: string | null;
}

/** Every line of the record, oldest first. */
export async function recordLines(db: PGlite): Promise<ActionLine[]> {
  const { rows } = await db.query<ActionLine>(
    `select operator_id, action, account_id, target, reason, outcome
       from public.operator_actions order by id`,
  );
  return rows;
}

/** A failed check of a site the account keeps. */
export async function failedCheckOf(db: PGlite, siteId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.checks (id, site_id, status, trigger, grade_version, queued_at, started_at,
                                finished_at, failure_reason)
     values (gen_random_uuid(), $1, 'failed', 'scheduled', '2.0.0', now() - interval '3 hours',
             now() - interval '3 hours', now() - interval '3 hours', 'reaped')
     returning id`,
    [siteId],
  );
  return rows[0]!.id;
}
