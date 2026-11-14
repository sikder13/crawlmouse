import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNT_KINDS, MAIL_KINDS, OWN_INBOX_KINDS } from '../lib/v2/mail/types';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { SHA, before as filesBefore } from './helpers/v2-check-tables';

/**
 * Migration 033, section K (docs/specs/v2/33-operations.md): the two founder kinds join the mailer's
 * ledger. As 031's section C does, the section rebuilds 028's CHECK on `email_sends.kind` and
 * `email_kind_suppressible` from what they hold when it runs, so the lists "before" are read from a
 * database migrated up to this file. The list afterwards is also held against the twelve kinds
 * production's CHECK listed on 2026-11-13 (owner ruling 6), named here by hand, so this test does not
 * only agree with the code it checks.
 */

const MIGRATION = '20261115000001_v2_033_operations.sql';
const ROLLBACK = '20261115000001_v2_033_operations.revert.sql';
const NOW = '2026-11-15T10:00:00.000Z';
const ADDED = ['founder_event', 'founder_digest'];
/** Production's `email_sends.kind` CHECK as read on 2026-11-13 at 16:21 ET (rulings-6.md). */
const PRODUCTION_KINDS = [
  'check_notify',
  'fix_to_developer',
  'trial_reminder',
  'email_change_confirm',
  'email_change_notice',
  'account_delete',
  'alert',
  'weekly_summary',
  'agency_plus_contact',
  'seat_invite',
  'report_confirm',
  'client_report',
];

const SECTION_K = /-- ═══ §K:[^\n]*\n([\s\S]*?)-- ═══ end §K/.exec(readMigration(MIGRATION))![1]!;
const REVERT_K = /-- ═══ §K ═[^\n]*\n([\s\S]*?)-- ═══ end §K/.exec(readRollback(ROLLBACK))![1]!;

let db: PGlite;
let hashes = 33_000;
const freshHash = () => SHA(++hashes);

async function kindChecks(): Promise<{ name: string; def: string }[]> {
  const { rows } = await db.query<{ name: string; def: string }>(
    `select c.conname as name, pg_get_constraintdef(c.oid) as def
       from pg_constraint c
      where c.conrelid = 'public.email_sends'::regclass and c.contype = 'c'
        and c.conkey = array[(select a.attnum from pg_attribute a
                               where a.attrelid = 'public.email_sends'::regclass and a.attname = 'kind')]
      order by c.conname`,
  );
  return rows;
}

async function listedKinds(): Promise<string[]> {
  const checks = await kindChecks();
  expect(checks).toHaveLength(1);
  return [...checks[0]!.def.matchAll(/'([a-z0-9_]+)'::text/g)].map((m) => m[1]!);
}

async function suppressibleAnswer(kind: string): Promise<boolean> {
  const { rows } = await asRole(db, 'service_role', null, (tx) =>
    tx.query<{ r: boolean }>(`select public.email_kind_suppressible($1) as r`, [kind]),
  );
  return rows[0]!.r;
}

async function claim(kind: string, hash: string): Promise<{ outcome: string }> {
  const { rows } = await asRole(db, 'service_role', null, (tx) =>
    tx.query<{ r: { outcome: string } }>(
      `select public.claim_email_send($1, $2, $3, null, $4) as r`,
      [`m:${kind}:${randomUUID()}`, kind, hash, NOW],
    ),
  );
  return rows[0]!.r;
}

const accepted = async (kind: string) => (await claim(kind, freshHash())).outcome === 'go';

async function underSuppression(kind: string): Promise<string> {
  const hash = freshHash();
  await asRole(db, 'service_role', null, (tx) =>
    tx.query(`select public.record_email_suppression($1, 'hard_bounce', $2)`, [hash, NOW]),
  );
  return (await claim(kind, hash)).outcome;
}

const countOf = async (kinds: readonly string[]) =>
  (
    await db.query<{ n: number }>(
      `select count(*)::int as n from public.email_sends where kind = any($1::text[])`,
      [`{${kinds.join(',')}}`],
    )
  ).rows[0]!.n;

let before: { kinds: string[]; suppressible: string[]; check: string };

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db, undefined, filesBefore(MIGRATION));
  const kinds = await listedKinds();
  const answers = await Promise.all(kinds.map(suppressibleAnswer));
  before = {
    kinds,
    suppressible: kinds.filter((_, i) => answers[i]),
    check: (await kindChecks())[0]!.def,
  };
  for (const kind of kinds) await claim(kind, freshHash());
  await db.exec(readMigration(MIGRATION));
}, 300_000);
afterAll(async () => db.close());

describe('after section K', () => {
  it('the CHECK lists production’s twelve kinds in their order, then the two founder kinds, under its own name', async () => {
    expect(before.kinds).toEqual(PRODUCTION_KINDS);
    expect(await listedKinds()).toEqual([...PRODUCTION_KINDS, ...ADDED]);
    expect((await kindChecks())[0]!.name).toBe('email_sends_kind_check');
  });

  it('every earlier kind is still taken, and keeps its answer under a suppression', async () => {
    for (const kind of before.kinds) {
      expect(await accepted(kind), kind).toBe(true);
      const suppressible = before.suppressible.includes(kind);
      expect(await suppressibleAnswer(kind), kind).toBe(suppressible);
      expect(await underSuppression(kind), kind).toBe(suppressible ? 'suppressed' : 'go');
    }
  });

  it('the two founder kinds are taken, and a suppression does not stop them', async () => {
    for (const kind of ADDED) {
      expect(await accepted(kind), kind).toBe(true);
      expect(await suppressibleAnswer(kind), kind).toBe(false);
      expect(await underSuppression(kind), kind).toBe('go');
    }
  });

  it('the database’s lists are the code’s: MAIL_KINDS, and the kinds neither account mail nor mail to our own inbox', async () => {
    const kinds = await listedKinds();
    expect([...kinds].sort()).toEqual([...MAIL_KINDS].sort());
    const answers = await Promise.all(kinds.map(suppressibleAnswer));
    expect(kinds.filter((_, i) => answers[i]).sort()).toEqual(
      MAIL_KINDS.filter((k) => !ACCOUNT_KINDS.has(k) && !OWN_INBOX_KINDS.has(k)).sort(),
    );
  });
});

describe('re-running and reverting section K', () => {
  it('applied a second time, the CHECK is the same and no ledger row is lost', async () => {
    const check = (await kindChecks())[0]!.def;
    const rows = await countOf([...before.kinds, ...ADDED]);
    await db.exec(SECTION_K);
    expect((await kindChecks())[0]!.def).toBe(check);
    expect(await countOf([...before.kinds, ...ADDED])).toBe(rows);
  });

  it('reverted, the CHECK is what it was: the two are refused and their rows gone, the others kept', async () => {
    const kept = await countOf(before.kinds);
    expect(await countOf(ADDED)).toBeGreaterThan(0);
    await db.exec(REVERT_K);
    expect((await kindChecks())[0]!.def).toBe(before.check);
    expect(await countOf(ADDED)).toBe(0);
    expect(await countOf(before.kinds)).toBe(kept);
    for (const kind of ADDED) {
      await expect(claim(kind, freshHash()), kind).rejects.toMatchObject({ code: '23514' });
    }
    for (const kind of before.kinds) {
      expect(await suppressibleAnswer(kind), kind).toBe(before.suppressible.includes(kind));
    }
  });

  it('the revert’s block runs a second time and changes nothing; the section applied again brings the two back', async () => {
    await db.exec(REVERT_K);
    expect((await kindChecks())[0]!.def).toBe(before.check);
    await db.exec(SECTION_K);
    expect(await listedKinds()).toEqual([...before.kinds, ...ADDED]);
    for (const kind of ADDED) expect(await accepted(kind), kind).toBe(true);
  });
});
