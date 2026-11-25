import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import { adminOver, person } from '@/lib/v2/account/sites-test-support';

vi.mock('server-only', () => ({}));

import { supabaseDomainStore, type BrandsClient } from './domain-store';

// Goal 1 row 25: the domain store against `agency_brands` as the migrations make it, through the
// PostgREST stand-in: the unique host, the `agency_brands_dns` pairing, and writes that land only
// while the account still holds the host they name.

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);
afterAll(async () => db?.close());

const NOW = new Date('2026-11-25T12:00:00.000Z');
const store = () => supabaseDomainStore(adminOver(db) as unknown as BrandsClient, () => NOW);

async function brand(): Promise<string> {
  const p = await person(db, 'agency');
  await db.query(`insert into public.agency_brands (account_id, agency_name) values ($1, 'A')`, [
    p.accountId,
  ]);
  return p.accountId;
}

describe('the domain store over agency_brands', () => {
  it('claims a host once, refuses it to another account, and refuses a second host', async () => {
    const [a, b] = [await brand(), await brand()];
    const s = store();
    expect(await s.claim(a, 'r.one-example.com', 't1')).toBe('claimed');
    expect(await s.claim(b, 'r.one-example.com', 't2')).toBe('in_use');
    expect(await s.claim(a, 'r.two-example.com', 't3')).toBe('has_host');
    expect(await s.read(a)).toEqual({
      host: 'r.one-example.com',
      status: 'unverified',
      txtToken: 't1',
      txtVerifiedAt: null,
      cnameFound: false,
      certificateAt: null,
      vercelAddedAt: null,
    });
    expect(await s.read(b)).toBeNull();
  });

  it('answers no_brand for an account with no brand row', async () => {
    const p = await person(db, 'nobrand');
    expect(await store().claim(p.accountId, 'r.three-example.com', 't')).toBe('no_brand');
    expect(await store().read(p.accountId)).toBe('no_brand');
  });

  it('writes a step only while the account still holds the host it names', async () => {
    const a = await brand();
    const s = store();
    await s.claim(a, 'r.four-example.com', 't');
    expect(await s.update(a, 'r.other-example.com', { status: 'verified' })).toBe(false);
    expect(
      await s.update(a, 'r.four-example.com', {
        status: 'pending',
        txtVerifiedAt: NOW.toISOString(),
        vercelAddedAt: NOW.toISOString(),
      }),
    ).toBe(true);
    expect(await s.read(a)).toMatchObject({ status: 'pending', vercelAddedAt: NOW.toISOString() });
  });

  it('clears every portal column together, keeping the brand, and frees the host', async () => {
    const [a, b] = [await brand(), await brand()];
    const s = store();
    await s.claim(a, 'r.five-example.com', 't');
    expect(await s.clear(a, 'r.wrong-example.com')).toBe(false);
    expect(await s.clear(a, 'r.five-example.com')).toBe(true);
    expect(await s.read(a)).toBeNull();
    const kept = await db.query(
      `select agency_name from public.agency_brands where account_id = $1`,
      [a],
    );
    expect(kept.rows).toEqual([{ agency_name: 'A' }]);
    expect(await s.claim(b, 'r.five-example.com', 't2')).toBe('claimed');
  });
});
