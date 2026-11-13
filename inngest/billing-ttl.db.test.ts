/**
 * C-4 against Postgres: `deleteExpiredAudits` over the migrated schema (PGlite, every migration
 * applied), so the expiry filter, the id order the batches page by, the report read and the delete
 * run as SQL on the real tables and foreign keys.
 *
 * The client below translates the builder calls `deleteExpiredAudits` makes, and only those, into
 * SQL run as `service_role`: `select(cols).lte().gt().order().limit()` and `delete().in()` on
 * `audits`, `select(cols).is(col, null).in()` on `public_reports`. Any other call is undefined and throws. The
 * shared PostgREST stand-in (`apps/web/__tests__/helpers/postgrest-pglite.ts`) does not model `lte`,
 * `gt` or `delete`. What this cannot show is PostgREST's own translation of those calls.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAllMigrations,
  asRole,
  freshDb,
} from '../apps/web/__tests__/helpers/pglite-migrations';
import { deleteExpiredAudits } from './billing-helpers';

const ident = (s: string) => {
  if (!/^[a-z_]+$/.test(s)) throw new Error(`not an identifier: ${s}`);
  return s;
};

function sqlClient(db: PGlite): SupabaseClient {
  const run = (sql: string, params: unknown[]) =>
    asRole(db, 'service_role', null, (tx) => tx.query<Record<string, unknown>>(sql, params))
      .then(({ rows }) => ({ data: rows, error: null }))
      .catch((error: unknown) => ({ data: null, error }));
  return {
    from: (table: string) => ({
      select: (cols: string) => {
        const where: string[] = [];
        const params: unknown[] = [];
        let order = '';
        const add = (clause: (p: string) => string, v: unknown) => {
          params.push(v);
          where.push(clause(`$${params.length}`));
        };
        const sql = (limit: string) =>
          `select ${cols
            .split(',')
            .map((c) => ident(c.trim()))
            .join(', ')} from public.${ident(table)}` +
          ` where ${where.join(' and ')}${order}${limit}`;
        const chain = {
          lte: (c: string, v: unknown) => (add((p) => `${ident(c)} <= ${p}`, v), chain),
          gt: (c: string, v: unknown) => (add((p) => `${ident(c)} > ${p}`, v), chain),
          is: (c: string, v: null) => {
            if (v !== null) throw new Error('is() is translated for null only');
            where.push(`${ident(c)} is null`);
            return chain;
          },
          order: (c: string, o: { ascending: boolean }) => {
            order = ` order by ${ident(c)} ${o.ascending ? 'asc' : 'desc'}`;
            return chain;
          },
          limit: (n: number) => run(sql(` limit ${Number(n)}`), params),
          in: (c: string, vs: string[]) => {
            add((p) => `${ident(c)} = any(${p}::uuid[])`, vs);
            return run(sql(''), params);
          },
        };
        return chain;
      },
      delete: () => ({
        in: (c: string, vs: string[]) =>
          run(`delete from public.${ident(table)} where ${ident(c)} = any($1::uuid[])`, [vs]),
      }),
    }),
  } as unknown as SupabaseClient;
}

const NOW = '2026-11-16T04:00:00.000Z';
const PAST = '2026-10-01T00:00:00.000Z';
const FUTURE = '2026-12-01T00:00:00.000Z';
/** An id whose last digits are `n`: lowercase hex, so Postgres' uuid order is their string order. */
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);
afterAll(async () => {
  await db?.close();
});

async function audit(n: number, expiresAt: string | null) {
  await db.query(
    `insert into public.audits (id, url, status, grade, score, expires_at)
     values ($1, $2, 'completed', 'B', 80, $3)`,
    [id(n), `https://site-${n}.example/`, expiresAt],
  );
}

async function report(n: number, state: 'published' | 'taken_down' | 'hidden' = 'published') {
  await db.query(
    `insert into public.public_reports (slug, audit_id, domain, takedown_requested_at, hidden_at)
     values ($1, $2, $3, $4, $5)`,
    [
      `report-${n}`,
      id(n),
      `site-${n}.example`,
      state === 'taken_down' ? PAST : null,
      state === 'hidden' ? PAST : null,
    ],
  );
}

const remaining = async () =>
  (await db.query<{ id: string }>(`select id from public.audits order by id`)).rows.map(
    (r) => r.id,
  );

describe('deleteExpiredAudits on the migrated schema (C-4)', () => {
  it('keeps every expired audit a report names, even when they fill the first batches, and deletes the rest', async () => {
    // Expired: 1–4 reported (the first two batches of two, in id order), 5–7 not. 8 is live, 9
    // has no expiry (a Pro audit). A page of an expired audit goes with it, by cascade.
    for (const n of [1, 2, 3, 4, 5, 6, 7]) await audit(n, PAST);
    await audit(8, FUTURE);
    await audit(9, null);
    for (const n of [1, 2, 3, 4]) await report(n);
    await db.query(
      `insert into public.pages (audit_id, url, url_hash, status_code) values ($1, 'https://site-5.example/', 'h5', 200)`,
      [id(5)],
    );

    const res = await deleteExpiredAudits(sqlClient(db), NOW, { batchSize: 2, maxIterations: 10 });

    expect(res).toEqual({ deleted: 3, kept: 4, drained: true, iterations: 4 });
    expect(await remaining()).toEqual([1, 2, 3, 4, 8, 9].map(id));
    const links = await db.query<{ slug: string; audit_id: string | null }>(
      `select slug, audit_id from public.public_reports order by slug`,
    );
    expect(links.rows).toEqual([1, 2, 3, 4].map((n) => ({ slug: `report-${n}`, audit_id: id(n) })));
    const pages = await db.query(`select 1 from public.pages where audit_id = $1`, [id(5)]);
    expect(pages.rows).toEqual([]);

    // A second run reads the kept audits again, deletes nothing and still drains.
    expect(
      await deleteExpiredAudits(sqlClient(db), NOW, { batchSize: 2, maxIterations: 10 }),
    ).toEqual({
      deleted: 0,
      kept: 4,
      drained: true,
      iterations: 2,
    });
  });

  it('lets an audit expire once its report is taken down or hidden', async () => {
    await db.query(`delete from public.public_reports`);
    await db.query(`delete from public.audits`);
    for (const n of [21, 22, 23]) await audit(n, PAST);
    await report(21);
    await report(22, 'taken_down');
    await report(23, 'hidden');

    const res = await deleteExpiredAudits(sqlClient(db), NOW, { batchSize: 10, maxIterations: 10 });

    expect(res).toEqual({ deleted: 2, kept: 1, drained: true, iterations: 1 });
    expect(await remaining()).toEqual([id(21)]);
  });
});
