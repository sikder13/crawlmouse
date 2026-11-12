import { createHash, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keptSite, person, type Person } from '../lib/v2/account/sites-test-support';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { insertRow, ROWS } from './helpers/v2-check-tables';

/**
 * Migration 031's share links (docs/specs/v2/31-agency.md §10): `share_links.revoked_at` and the four
 * functions, run as `service_role` on PGlite with every migration applied. Each test seeds its own
 * account, site and report.
 */

const MIGRATION = '20261114000002_v2_031_agency.sql';
const ROLLBACK = '20261114000002_v2_031_agency.revert.sql';
const NOW = '2026-11-12T12:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;
const at = (days: number, ms = 0) => new Date(Date.parse(NOW) + days * DAY_MS + ms).toISOString();
const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

const FUNCTIONS = [
  'public.report_file_stored(reports)',
  'public.create_share_link(uuid, text, uuid, timestamptz)',
  'public.open_share_link(text, timestamptz)',
  'public.read_share_link(text, timestamptz)',
  'public.revoke_share_links(uuid, timestamptz)',
] as const;

type Answer = { outcome: string } & Record<string, unknown>;

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 120_000);
afterAll(async () => db.close());

/** One statement as the service role, the only role the functions are granted to. */
const service = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
  asRole(db, 'service_role', null, async (tx) => (await tx.query<T>(sql, params)).rows);

const answer = async (sql: string, params: unknown[]): Promise<Answer> =>
  (await service<{ r: Answer }>(sql, params))[0]!.r;

const create = (reportId: string, token: string, userId: string | null, now = NOW) =>
  answer(`select public.create_share_link($1, $2, $3, $4) r`, [
    reportId,
    sha256(token),
    userId,
    now,
  ]);
const open = (token: string, now = NOW) =>
  answer(`select public.open_share_link($1, $2) r`, [sha256(token), now]);
const read = (token: string, now = NOW) =>
  answer(`select public.read_share_link($1, $2) r`, [sha256(token), now]);
const revoke = async (reportId: string, now = NOW) =>
  (await service<{ n: number }>(`select public.revoke_share_links($1, $2) n`, [reportId, now]))[0]!
    .n;

interface Seeded {
  owner: Person;
  siteId: string;
  reportId: string;
  path: string;
}

/** A report of a new account's site: with a stored file unless `stored` is false. */
async function report(
  opts: { stored?: boolean; kind?: string; format?: string } = {},
): Promise<Seeded> {
  const owner = await person(db, 'owner');
  const site = await keptSite(db, owner.accountId);
  const reportId = randomUUID();
  const path = `${owner.accountId}/${reportId}.pdf`;
  await insertRow(db, 'reports', {
    ...ROWS.reports(reportId, owner.accountId, site.id, randomUUID()),
    kind: opts.kind ?? 'audit_pdf',
    format: opts.format ?? 'pdf',
    storage_path: opts.stored === false ? null : path,
  });
  return { owner, siteId: site.id, reportId, path };
}

interface LinkRow {
  token_hash: string;
  expires_at: Date;
  created_by: string | null;
  view_count: number;
  revoked_at: Date | null;
  created_at: Date;
}

const links = async (reportId: string) =>
  (
    await db.query<LinkRow>(
      `select * from public.share_links where report_id = $1 order by created_at, token_hash`,
      [reportId],
    )
  ).rows;

const shareExpiry = async (reportId: string) =>
  (
    await db.query<{ share_expires_at: Date | null }>(
      `select share_expires_at from public.reports where id = $1`,
      [reportId],
    )
  ).rows[0]!.share_expires_at;

describe('create_share_link', () => {
  it('stores the hash it is given with an expiry 30 days on, and sets the report’s share_expires_at to it', async () => {
    const r = await report();
    expect(await create(r.reportId, 'token-one', r.owner.id)).toEqual({
      outcome: 'created',
      expires_at: expect.any(String),
    });
    const [link] = await links(r.reportId);
    expect(link).toMatchObject({
      token_hash: sha256('token-one'),
      created_by: r.owner.id,
      view_count: 0,
      revoked_at: null,
    });
    expect(link!.expires_at.toISOString()).toBe(at(30));
    expect(link!.created_at.toISOString()).toBe(NOW);
    expect((await shareExpiry(r.reportId))!.toISOString()).toBe(at(30));
  });

  it('refuses a value that is not a sha256 in lowercase hex: the token itself cannot be stored', async () => {
    const r = await report();
    await expect(
      service(`select public.create_share_link($1, $2, $3, $4)`, [
        r.reportId,
        'kJ8sT2mQ9xLp4VnR7bWc1A',
        r.owner.id,
        NOW,
      ]),
    ).rejects.toMatchObject({ constraint: 'share_links_token_hash' });
    expect(await links(r.reportId)).toEqual([]);
    expect(await shareExpiry(r.reportId)).toBeNull();
  });

  it('answers not_ready for a report with no stored file, and not_found for no report, and writes nothing', async () => {
    const pending = await report({ stored: false });
    expect(await create(pending.reportId, 'a', pending.owner.id)).toEqual({ outcome: 'not_ready' });
    expect(await create(randomUUID(), 'b', pending.owner.id)).toEqual({ outcome: 'not_found' });
    expect(await links(pending.reportId)).toEqual([]);
    expect(await shareExpiry(pending.reportId)).toBeNull();
  });

  it('leaves a report one link that opens: a new link revokes the one before', async () => {
    const r = await report();
    await create(r.reportId, 'first', r.owner.id);
    await create(r.reportId, 'second', r.owner.id, at(1));
    expect((await open('first', at(1, 1000))).outcome).toBe('gone');
    expect((await open('second', at(1, 1000))).outcome).toBe('open');
    const rows = await links(r.reportId);
    expect(rows.map((l) => l.revoked_at?.toISOString() ?? null)).toEqual([at(1), null]);
    expect((await shareExpiry(r.reportId))!.toISOString()).toBe(at(31));
  });

  it('raises for a null report, hash or time', async () => {
    const r = await report();
    for (const params of [
      [null, sha256('x'), r.owner.id, NOW],
      [r.reportId, null, r.owner.id, NOW],
      [r.reportId, sha256('x'), r.owner.id, null],
    ]) {
      await expect(
        service(`select public.create_share_link($1, $2, $3, $4)`, params),
      ).rejects.toMatchObject({ code: '22004' });
    }
  });
});

describe('open_share_link', () => {
  it('returns the report’s id, account, site, kind, format and path, and counts the view', async () => {
    const r = await report({ kind: 'compare', format: 'html' });
    const tok = randomUUID();
    await create(r.reportId, tok, r.owner.id);
    const expected = {
      outcome: 'open',
      report_id: r.reportId,
      account_id: r.owner.accountId,
      site_id: r.siteId,
      kind: 'compare',
      format: 'html',
      storage_path: r.path,
    };
    expect(await open(tok)).toEqual(expected);
    expect(await open(tok, at(29))).toEqual(expected);
    expect((await links(r.reportId))[0]!.view_count).toBe(2);
  });

  it('is unknown for a hash no link holds', async () => {
    await report();
    expect(await open('never-made')).toEqual({ outcome: 'unknown' });
  });

  it('is gone from the moment of expiry, 30 days on, and counts no view for it', async () => {
    const r = await report();
    const tok = randomUUID();
    await create(r.reportId, tok, r.owner.id);
    expect((await open(tok, at(30, -1))).outcome).toBe('open');
    expect(await open(tok, at(30))).toEqual({ outcome: 'gone' });
    expect(await open(tok, at(400))).toEqual({ outcome: 'gone' });
    expect((await links(r.reportId))[0]!.view_count).toBe(1);
  });

  it('is gone once revoked, and counts no view for it', async () => {
    const r = await report();
    const tok = randomUUID();
    await create(r.reportId, tok, r.owner.id);
    expect(await revoke(r.reportId, at(1))).toBe(1);
    expect(await open(tok, at(1))).toEqual({ outcome: 'gone' });
    expect((await links(r.reportId))[0]!.view_count).toBe(0);
  });

  it('is gone when the report’s file is no longer stored', async () => {
    const r = await report();
    const tok = randomUUID();
    await create(r.reportId, tok, r.owner.id);
    await db.query(`update public.reports set storage_path = null where id = $1`, [r.reportId]);
    expect(await open(tok)).toEqual({ outcome: 'gone' });
  });

  it('is gone for an account marked for deletion, opens again once the mark is cleared, and is gone for a deleted one', async () => {
    const r = await report();
    const tok = randomUUID();
    await create(r.reportId, tok, r.owner.id);
    await db.query(
      `update public.accounts set deletion_confirmed_at = now(), purge_after = now() + interval '7 days' where id = $1`,
      [r.owner.accountId],
    );
    expect(await open(tok)).toEqual({ outcome: 'gone' });
    expect(await read(tok)).toEqual({ outcome: 'gone' });
    await db.query(
      `update public.accounts set deletion_confirmed_at = null, purge_after = null where id = $1`,
      [r.owner.accountId],
    );
    expect((await open(tok)).outcome).toBe('open');
    await db.query(`update public.accounts set deleted_at = now() where id = $1`, [
      r.owner.accountId,
    ]);
    expect(await open(tok)).toEqual({ outcome: 'gone' });
    expect((await links(r.reportId))[0]!.view_count).toBe(1);
  });
});

describe('read_share_link', () => {
  it('answers as open_share_link does and counts nothing', async () => {
    const r = await report({ kind: 'compare', format: 'html' });
    const tok = randomUUID();
    await create(r.reportId, tok, r.owner.id);
    expect(await read(tok)).toEqual({
      outcome: 'open',
      report_id: r.reportId,
      account_id: r.owner.accountId,
      site_id: r.siteId,
      kind: 'compare',
      format: 'html',
      storage_path: r.path,
    });
    expect(await read(tok, at(30))).toEqual({ outcome: 'gone' });
    expect(await read('other')).toEqual({ outcome: 'unknown' });
    await revoke(r.reportId);
    expect(await read(tok)).toEqual({ outcome: 'gone' });
    expect((await links(r.reportId))[0]!.view_count).toBe(0);
  });
});

describe('report_file_stored', () => {
  it('is the one test of a stored file the share functions make: each calls it, and none tests storage_path or file_state itself', () => {
    const sql = readMigration(MIGRATION);
    const body = (name: string) => {
      const from = sql.indexOf(`create or replace function public.${name}(`);
      expect(from, name).toBeGreaterThan(-1);
      return sql.slice(from, sql.indexOf('$$;', from));
    };
    for (const name of ['create_share_link', 'open_share_link', 'read_share_link']) {
      expect(body(name), name).toContain('public.report_file_stored(r)');
      expect(body(name), name).not.toMatch(
        /storage_path\s+is\s+(not\s+)?null|file_state\s*(=|<>|is|in)/,
      );
    }
  });

  it('answers for a report’s row: true with a stored file, false without', async () => {
    const [stored, pending] = [await report(), await report({ stored: false })];
    const { rows } = await db.query<{ id: string; stored: boolean }>(
      `select r.id, public.report_file_stored(r) stored from public.reports r where r.id = any($1::uuid[])`,
      [`{${stored.reportId},${pending.reportId}}`],
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.stored]))).toEqual({
      [stored.reportId]: true,
      [pending.reportId]: false,
    });
  });
});

describe('revoke_share_links', () => {
  it('revokes the report’s link, clears share_expires_at, and leaves another report’s link', async () => {
    const [a, b] = [await report(), await report()];
    await create(a.reportId, 'a-tok', a.owner.id);
    await create(b.reportId, 'b-tok', b.owner.id);
    expect(await revoke(a.reportId, at(2))).toBe(1);
    expect((await links(a.reportId))[0]!.revoked_at!.toISOString()).toBe(at(2));
    expect(await shareExpiry(a.reportId)).toBeNull();
    expect((await open('b-tok', at(2))).outcome).toBe('open');
    expect(await shareExpiry(b.reportId)).not.toBeNull();
  });

  it('revokes nothing twice: the first time of revocation stays', async () => {
    const r = await report();
    const tok = randomUUID();
    await create(r.reportId, tok, r.owner.id);
    await revoke(r.reportId, at(1));
    expect(await revoke(r.reportId, at(5))).toBe(0);
    expect((await links(r.reportId))[0]!.revoked_at!.toISOString()).toBe(at(1));
  });
});

describe('grants', () => {
  it('lets service_role execute each function, and no client role or PUBLIC', async () => {
    const { rows } = await db.query<{ f: string; role: string; can: boolean }>(
      `select f.f, r.role, has_function_privilege(r.role, f.f, 'EXECUTE') can
         from unnest($1::text[]) f(f)
        cross join (values ('anon'), ('authenticated'), ('public'), ('service_role')) r(role)`,
      [`{${FUNCTIONS.map((f) => `"${f}"`).join(',')}}`],
    );
    const may: Record<string, string[]> = {};
    for (const r of rows) if (r.can) (may[r.f] ??= []).push(r.role);
    expect(may).toEqual(Object.fromEntries(FUNCTIONS.map((f) => [f, ['service_role']])));
  });

  it('refuses a signed-in member and a visitor who call one directly, and their read of the table', async () => {
    const r = await report();
    const tok = randomUUID();
    await create(r.reportId, tok, r.owner.id);
    for (const role of ['anon', 'authenticated'] as const) {
      const uid = role === 'anon' ? null : r.owner.id;
      for (const sql of [
        `select public.open_share_link('${sha256(tok)}', now())`,
        `select public.read_share_link('${sha256(tok)}', now())`,
        `select public.revoke_share_links('${r.reportId}', now())`,
        `select public.create_share_link('${r.reportId}', '${sha256('x')}', null, now())`,
        `select revoked_at from public.share_links`,
      ]) {
        await expect(
          asRole(db, role, uid, (tx) => tx.query(sql)),
          `${role}: ${sql}`,
        ).rejects.toMatchObject({ code: '42501' });
      }
    }
    expect((await links(r.reportId))[0]).toMatchObject({ view_count: 0, revoked_at: null });
  });

  it('pins the search_path of each to pg_catalog, pg_temp', async () => {
    const { rows } = await db.query<{ f: string; config: string[] | null }>(
      `select f.f, p.proconfig config from unnest($1::text[]) f(f)
         join pg_proc p on p.oid = f.f::regprocedure`,
      [`{${FUNCTIONS.map((f) => `"${f}"`).join(',')}}`],
    );
    expect(Object.fromEntries(rows.map((r) => [r.f, r.config]))).toEqual(
      Object.fromEntries(FUNCTIONS.map((f) => [f, ['search_path=pg_catalog, pg_temp']])),
    );
  });
});

describe('the migration', () => {
  it('applies twice, reverts to no share function and no revoked_at, reverts twice, and applies again', async () => {
    const state = async () => ({
      functions: (
        await db.query<{ proname: string }>(
          `select proname from pg_proc
            where pronamespace = 'public'::regnamespace
              and proname in ('report_file_stored', 'create_share_link', 'open_share_link',
                              'read_share_link', 'revoke_share_links')
            order by 1`,
        )
      ).rows.map((r) => r.proname),
      column: (
        await db.query(
          `select 1 from pg_attribute
            where attrelid = 'public.share_links'::regclass and attname = 'revoked_at' and not attisdropped`,
        )
      ).rows.length,
    });
    const applied = {
      functions: [
        'create_share_link',
        'open_share_link',
        'read_share_link',
        'report_file_stored',
        'revoke_share_links',
      ],
      column: 1,
    };
    const reverted = { functions: [], column: 0 };

    await db.exec(readMigration(MIGRATION));
    expect(await state()).toEqual(applied);
    await db.exec(readRollback(ROLLBACK));
    expect(await state()).toEqual(reverted);
    await db.exec(readRollback(ROLLBACK));
    expect(await state()).toEqual(reverted);
    await db.exec(readMigration(MIGRATION));
    expect(await state()).toEqual(applied);
  });
});
