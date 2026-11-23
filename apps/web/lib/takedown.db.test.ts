/**
 * F-184: a takedown is about a host. `processTakedown` against the real `public_reports` and
 * `takedown_requests` (PGlite, every migration applied), through the read the embed badge uses.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../__tests__/helpers/postgrest-pglite';

const { purgePublicReport } = vi.hoisted(() => ({ purgePublicReport: vi.fn() }));
vi.mock('./reports', () => ({ purgePublicReport }));

import { processTakedown } from './takedown';

let db: PGlite;
const SLUGS = ['named', 'older', 'oldest'];

async function seed() {
  await db.query('delete from public.takedown_requests');
  await db.query('delete from public.public_reports');
  for (const [i, slug] of SLUGS.entries()) {
    await db.query(
      `insert into public.public_reports (slug, domain, created_at)
       values ($1, 'taken.example', now() - make_interval(days => $2))`,
      [slug, i],
    );
  }
  await db.query(
    `insert into public.public_reports (slug, domain) values ('other-host', 'other.example'),
       ('sub-host', 'blog.taken.example')`,
  );
  for (const [slug, status] of [
    ['named', 'pending'],
    ['older', 'verified'],
    ['oldest', 'rejected'],
    ['other-host', 'pending'],
  ]) {
    await db.query(
      `insert into public.takedown_requests (public_report_slug, domain, requester_email, reason, status)
       values ($1, $2, 'owner@example.com', 'mine', $3)`,
      [slug, slug === 'other-host' ? 'other.example' : 'taken.example', status],
    );
  }
}

const down = async () =>
  (
    await db.query<{ slug: string }>(
      'select slug from public.public_reports where takedown_requested_at is not null order by slug',
    )
  ).rows.map((r) => r.slug);
const status = async (slug: string) =>
  (
    await db.query<{ status: string }>(
      'select status from public.takedown_requests where public_report_slug = $1',
      [slug],
    )
  ).rows[0]!.status;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  purgePublicReport.mockClear();
  await seed();
});

describe('processTakedown closes the host', () => {
  it('takes down each report of the host, and no other host’s, a subdomain included', async () => {
    await processTakedown(postgrestOver(db), 'named');
    expect(await down()).toEqual(['named', 'older', 'oldest']);
  });

  it('purges each report of the host, and only those', async () => {
    await processTakedown(postgrestOver(db), 'named');
    expect(purgePublicReport.mock.calls.map(([s]) => s).sort()).toEqual([
      'named',
      'older',
      'oldest',
    ]);
  });

  it('closes the open requests on the host’s reports, and leaves a decided one', async () => {
    await processTakedown(postgrestOver(db), 'named');
    expect(await status('named')).toBe('removed');
    expect(await status('older')).toBe('removed');
    expect(await status('oldest')).toBe('rejected');
    expect(await status('other-host')).toBe('pending');
  });

  it('keeps the first takedown’s time when it runs again', async () => {
    await db.query(
      `update public.public_reports set takedown_requested_at = '2026-01-01T00:00:00Z' where slug = 'older'`,
    );
    await processTakedown(postgrestOver(db), 'named');
    const { rows } = await db.query<{ at: string }>(
      `select to_char(takedown_requested_at at time zone 'UTC', 'YYYY-MM-DD') as at from public.public_reports where slug = 'older'`,
    );
    expect(rows[0]!.at).toBe('2026-01-01');
  });

  it('a second run purges the host again and changes nothing else', async () => {
    await processTakedown(postgrestOver(db), 'named');
    purgePublicReport.mockClear();
    await processTakedown(postgrestOver(db), 'named');
    expect(purgePublicReport).toHaveBeenCalledTimes(3);
    expect(await down()).toEqual(['named', 'older', 'oldest']);
  });

  it('a slug that names no report changes nothing, and purges nothing', async () => {
    expect(await processTakedown(postgrestOver(db), 'no-such-slug')).toBe(0);
    expect(await down()).toEqual([]);
    expect(purgePublicReport).not.toHaveBeenCalled();
    expect(await status('named')).toBe('pending');
  });

  it('answers how many reports the host has, for the audit log', async () => {
    expect(await processTakedown(postgrestOver(db), 'named')).toBe(3);
  });

  it('closes a host with more reports than one read returns', async () => {
    const capped = postgrestOver(db, { maxRows: 2 });
    await processTakedown(capped, 'named');
    expect(await down()).toEqual(['named', 'older', 'oldest']);
    expect(purgePublicReport.mock.calls.map(([s]) => s).sort()).toEqual([
      'named',
      'older',
      'oldest',
    ]);
    expect(await status('older')).toBe('removed');
  });

  it('a report removed during the walk does not make it skip the next', async () => {
    const purged: string[] = [];
    purgePublicReport.mockImplementation((slug: string) => {
      purged.push(slug);
      if (slug === 'named') void db.query(`delete from public.public_reports where slug = 'named'`);
    });
    await processTakedown(postgrestOver(db, { maxRows: 2 }), 'named');
    purgePublicReport.mockReset();
    expect(purged).toEqual(['named', 'older', 'oldest']);
  });

  it('walks by key when rows were stored out of key order', async () => {
    for (const slug of ['zeta', 'alpha', 'mid', 'beta', 'yak']) {
      await db.query(
        `insert into public.public_reports (slug, domain) values ($1, 'shuffled.example')`,
        [slug],
      );
    }
    await processTakedown(postgrestOver(db, { maxRows: 2 }), 'mid');
    expect(purgePublicReport.mock.calls.map(([s]) => s)).toEqual([
      'alpha',
      'beta',
      'mid',
      'yak',
      'zeta',
    ]);
  });

  it('reads each report once, however the reads are cut', async () => {
    await processTakedown(postgrestOver(db, { maxRows: 2 }), 'named');
    const seen = purgePublicReport.mock.calls.map(([s]) => s);
    expect(seen).toHaveLength(new Set(seen).size);
    expect(seen).toHaveLength(3);
  });

  it('still purges each report when the queue write fails', async () => {
    const real = postgrestOver(db);
    const failing = {
      from: (table: string) =>
        table === 'takedown_requests'
          ? {
              update: () => ({
                eq: () => ({ in: async () => ({ error: new Error('queue down') }) }),
              }),
            }
          : real.from(table),
    } as unknown as typeof real;
    await expect(processTakedown(failing, 'named')).rejects.toThrow(/queue down/);
    expect(purgePublicReport).toHaveBeenCalledTimes(3);
  });
});
