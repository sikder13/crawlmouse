/**
 * `hostTakenDown` against the real `public_reports` (PGlite, every migration applied), over the shapes
 * a takedown can sit in.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from '../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../__tests__/helpers/postgrest-pglite';
import { normalizeDomain } from './domain';
import { hostTakenDown } from './host-takedown';

let db: PGlite;

const report = (
  slug: string,
  domain: string,
  column: 'takedown_requested_at' | 'hidden_at' | null,
) =>
  db.query(
    `insert into public.public_reports (slug, domain${column ? `, ${column}` : ''})
     values ($1, $2${column ? ', now()' : ''})`,
    [slug, domain],
  );

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  await report('down', 'taken.example', 'takedown_requested_at');
  await report('live-beside', 'taken.example', null);
  await report('only-hidden', 'hidden.example', 'hidden_at');
  await report('only-live', 'live.example', null);
}, 300_000);
afterAll(async () => {
  await db?.close();
});

const down = (host: string) => hostTakenDown(postgrestOver(db), normalizeDomain(host));

describe('hostTakenDown', () => {
  it('is true for the host, however it is written', async () => {
    for (const host of [
      'taken.example',
      'www.taken.example',
      'WWW.Taken.Example.',
      'taken.example..',
    ]) {
      expect(await down(host), host).toBe(true);
    }
  });

  it('is false for a hidden report, a live one, and a host with none', async () => {
    for (const host of ['hidden.example', 'live.example', 'never.example']) {
      expect(await down(host), host).toBe(false);
    }
  });

  it('a subdomain is its own host', async () => {
    expect(await down('blog.taken.example')).toBe(false);
  });

  it('throws on a failed read, and the message carries no upstream text', async () => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'not']) q[m] = () => q;
    q.limit = async () => ({ data: null, error: { message: 'SENTINEL' } });
    const broken = { from: () => q } as unknown as ReturnType<typeof postgrestOver>;
    await expect(hostTakenDown(broken, 'x.example')).rejects.toThrow(
      'public_reports takedown read failed',
    );
  });
});
