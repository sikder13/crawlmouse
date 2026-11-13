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
 * Migration 031, section C (docs/specs/v2/31-agency.md §6 and §10): three kinds join the mailer's
 * ledger. The two definitions that list kinds (028's CHECK on `email_sends.kind` and
 * `email_kind_suppressible`) are rebuilt from what they hold when the section runs, so the lists
 * "before" are read here from a database migrated up to this file, and what is asserted afterwards is
 * what the database does with a kind: a claim of it is taken or refused, and a suppression stops it or
 * does not. The last describe stands in for a migration that added a kind before this one.
 */

const MIGRATION = '20261114000002_v2_031_agency.sql';
const ROLLBACK = '20261114000002_v2_031_agency.revert.sql';
const NOW = '2026-11-14T10:00:00.000Z';
/** 028's kinds, as its file writes them; a later migration may have added to them. */
const CC28_KINDS = [
  'check_notify',
  'fix_to_developer',
  'trial_reminder',
  'email_change_confirm',
  'email_change_notice',
  'account_delete',
  'alert',
  'weekly_summary',
];
const ADDED = ['seat_invite', 'report_confirm', 'client_report'];
const ADDED_SUPPRESSIBLE = ['client_report'];

/** The text of the migration's section C, and of the revert's block for it. */
const SECTION_C = /-- ═══ C: [^\n]*\n([\s\S]*?)-- ═══ end C /.exec(readMigration(MIGRATION))![1]!;
const REVERT_C = /-- ─── C ─[^\n]*\n([\s\S]*?)-- ─── B ─/.exec(readRollback(ROLLBACK))![1]!;

let db: PGlite;
let hashes = 31_000;
const freshHash = () => SHA(++hashes);

/** The CHECKs on `email_sends.kind` alone, as the catalog prints them. */
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

/** The kinds the CHECK lists, in its order. */
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

/** A claim of a new key of `kind` for `hash`, as the mailer makes it. */
async function claim(kind: string, hash: string): Promise<{ outcome: string }> {
  const { rows } = await asRole(db, 'service_role', null, (tx) =>
    tx.query<{ r: { outcome: string } }>(
      `select public.claim_email_send($1, $2, $3, null, $4) as r`,
      [`m:${kind}:${randomUUID()}`, kind, hash, NOW],
    ),
  );
  return rows[0]!.r;
}

/** Whether the ledger takes a row of `kind`: a claim for an address no suppression names. */
const accepted = async (kind: string) => (await claim(kind, freshHash())).outcome === 'go';

/** What a claim answers for `kind` to an address that hard-bounced. */
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

describe('the kinds before this migration, read from the catalog', () => {
  it('hold 028’s eight, four of them suppressible', () => {
    expect(before.kinds).toEqual(expect.arrayContaining(CC28_KINDS));
    expect(before.suppressible).toEqual(
      expect.arrayContaining(['check_notify', 'fix_to_developer', 'alert', 'weekly_summary']),
    );
    for (const kind of ADDED) expect(before.kinds).not.toContain(kind);
  });
});

describe('after section C', () => {
  it('every earlier kind is still taken, and keeps its answer under a suppression', async () => {
    for (const kind of before.kinds) {
      expect(await accepted(kind), kind).toBe(true);
      const suppressible = before.suppressible.includes(kind);
      expect(await suppressibleAnswer(kind), kind).toBe(suppressible);
      expect(await underSuppression(kind), kind).toBe(suppressible ? 'suppressed' : 'go');
    }
  });

  it('the three new kinds are taken; a suppression stops the client report and not the other two', async () => {
    for (const kind of ADDED) {
      expect(await accepted(kind), kind).toBe(true);
      const suppressible = ADDED_SUPPRESSIBLE.includes(kind);
      expect(await suppressibleAnswer(kind), kind).toBe(suppressible);
      expect(await underSuppression(kind), kind).toBe(suppressible ? 'suppressed' : 'go');
    }
  });

  it('a kind in neither list is refused by the CHECK', async () => {
    for (const kind of ['seat_invites', 'client_reports', 'no_such_kind', '']) {
      await expect(claim(kind, freshHash()), kind).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('the database’s lists are the code’s: MAIL_KINDS, and the kinds that are neither account mail nor mail to our own inbox', async () => {
    const kinds = await listedKinds();
    expect([...kinds].sort()).toEqual([...MAIL_KINDS].sort());
    const answers = await Promise.all(kinds.map(suppressibleAnswer));
    expect(kinds.filter((_, i) => answers[i]).sort()).toEqual(
      // Neither account mail nor mail to our own inbox (CC-29's kind, which 031's block keeps).
      MAIL_KINDS.filter((k) => !ACCOUNT_KINDS.has(k) && !OWN_INBOX_KINDS.has(k)).sort(),
    );
  });

  it('the earlier kinds keep their order and the new ones follow, under the constraint’s own name', async () => {
    expect(await listedKinds()).toEqual([...before.kinds, ...ADDED]);
    expect((await kindChecks())[0]!.name).toBe('email_sends_kind_check');
  });

  it('no client role may call email_kind_suppressible; the service role may', async () => {
    const { rows } = await db.query<{ role: string; ok: boolean }>(
      `select r as role, has_function_privilege(r, 'public.email_kind_suppressible(text)', 'execute') as ok
         from unnest(array['anon', 'authenticated', 'service_role']) r`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.role, r.ok]))).toEqual({
      anon: false,
      authenticated: false,
      service_role: true,
    });
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        asRole(db, role, null, (tx) =>
          tx.query(`select public.email_kind_suppressible('client_report')`),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });
});

describe('re-running and reverting', () => {
  it('applied a second time, the two definitions are the same and no ledger row is lost', async () => {
    const check = (await kindChecks())[0]!.def;
    const rows = await countOf([...before.kinds, ...ADDED]);
    await db.exec(readMigration(MIGRATION));
    expect((await kindChecks())[0]!.def).toBe(check);
    expect(await countOf([...before.kinds, ...ADDED])).toBe(rows);
    for (const kind of [...before.kinds, ...ADDED]) expect(await accepted(kind), kind).toBe(true);
  });

  it('reverted, the lists are what they were before: the three are refused, their rows gone, the others kept', async () => {
    const kept = await countOf(before.kinds);
    expect(await countOf(ADDED)).toBeGreaterThan(0);
    await db.exec(readRollback(ROLLBACK));
    expect((await kindChecks())[0]!.def).toBe(before.check);
    expect(await countOf(ADDED)).toBe(0);
    expect(await countOf(before.kinds)).toBe(kept);
    for (const kind of ADDED) {
      await expect(claim(kind, freshHash()), kind).rejects.toMatchObject({ code: '23514' });
      expect(await suppressibleAnswer(kind), kind).toBe(false);
    }
    for (const kind of before.kinds) {
      expect(await accepted(kind), kind).toBe(true);
      expect(await suppressibleAnswer(kind), kind).toBe(before.suppressible.includes(kind));
    }
  });

  it('the revert’s block for this section runs a second time and changes nothing', async () => {
    await db.exec(REVERT_C);
    expect((await kindChecks())[0]!.def).toBe(before.check);
  });

  it('applied again after the revert, the three are back', async () => {
    await db.exec(readMigration(MIGRATION));
    expect(await listedKinds()).toEqual([...before.kinds, ...ADDED]);
    for (const kind of ADDED) expect(await accepted(kind), kind).toBe(true);
  });
});

/**
 * Another migration that sorts before this one may add a kind to the same two definitions. Each case
 * restates them as such a file would, under a constraint name of its choosing and with its kind
 * suppressible or not, then runs section C alone and the revert's block alone.
 */
describe('a kind another migration added before this one', () => {
  /** A name no migration uses, so this stays a stand-in whatever kinds are added later. */
  const OTHER = 'kind_of_an_earlier_migration';

  /** The two definitions as an earlier migration would leave them, with one more kind. */
  async function earlierMigration(name: string, suppressible: boolean): Promise<void> {
    const quoted = (kinds: readonly string[]) => kinds.map((k) => `'${k}'`).join(', ');
    await db.exec(REVERT_C);
    const current = (await kindChecks())[0]!.name;
    await db.exec(`
      alter table public.email_sends drop constraint "${current}";
      alter table public.email_sends add constraint "${name}"
        check (kind in (${quoted([...before.kinds, OTHER])}));
      create or replace function public.email_kind_suppressible(p_kind text)
      returns boolean language sql immutable set search_path = pg_catalog, pg_temp
      as $f$ select p_kind in (${quoted([...before.suppressible, ...(suppressible ? [OTHER] : [])])}); $f$;
    `);
  }

  /** Back to 028's two definitions with section C run over them, for the cases that follow. */
  async function restore(): Promise<void> {
    const quoted = (kinds: readonly string[]) => kinds.map((k) => `'${k}'`).join(', ');
    await db.query(`delete from public.email_sends where kind <> all($1::text[])`, [
      `{${before.kinds.join(',')}}`,
    ]);
    const current = (await kindChecks())[0]!.name;
    await db.exec(`
      alter table public.email_sends drop constraint "${current}";
      alter table public.email_sends add constraint email_sends_kind_check
        check (kind in (${quoted(before.kinds)}));
      create or replace function public.email_kind_suppressible(p_kind text)
      returns boolean language sql immutable set search_path = pg_catalog, pg_temp
      as $f$ select p_kind in (${quoted(before.suppressible)}); $f$;
    `);
    await db.exec(SECTION_C);
  }

  it.each([
    ['email_sends_kind_check', true],
    ['email_sends_kind_check', false],
    ['email_sends_kinds_v2', true],
    ['email_sends_kinds_v2', false],
  ] as const)(
    'under the constraint %s, suppressible %s: section C keeps it, and so does the revert',
    async (name, suppressible) => {
      await earlierMigration(name, suppressible);
      await db.exec(SECTION_C);
      expect(await listedKinds()).toEqual([...before.kinds, OTHER, ...ADDED]);
      expect((await kindChecks())[0]!.name).toBe(name);
      expect(await accepted(OTHER)).toBe(true);
      expect(await underSuppression(OTHER)).toBe(suppressible ? 'suppressed' : 'go');
      for (const kind of ADDED) {
        expect(await underSuppression(kind), kind).toBe(
          ADDED_SUPPRESSIBLE.includes(kind) ? 'suppressed' : 'go',
        );
      }
      for (const kind of before.kinds) {
        expect(await underSuppression(kind), kind).toBe(
          before.suppressible.includes(kind) ? 'suppressed' : 'go',
        );
      }

      await db.exec(REVERT_C);
      expect(await listedKinds()).toEqual([...before.kinds, OTHER]);
      expect(await accepted(OTHER)).toBe(true);
      expect(await underSuppression(OTHER)).toBe(suppressible ? 'suppressed' : 'go');
      await restore();
    },
  );

  it.each([
    ['a pattern', `check (kind ~ '^[a-z_]+$')`],
    [
      'a list with a second condition',
      `check (kind in ('alert', 'check_notify') and length(kind) < 40)`,
    ],
  ])(
    'a CHECK that is not a plain list (%s) stops section C, and is left as it was',
    async (_, sql) => {
      await db.exec(REVERT_C);
      await db.query(`delete from public.email_sends`);
      const current = (await kindChecks())[0]!.name;
      await db.exec(`
      alter table public.email_sends drop constraint "${current}";
      alter table public.email_sends add constraint email_sends_kind_check ${sql};
    `);
      const def = (await kindChecks())[0]!.def;
      await expect(db.exec(SECTION_C)).rejects.toThrow(
        /email_sends\.kind: the CHECK .* is not a plain list/,
      );
      expect((await kindChecks())[0]!.def).toBe(def);
      await expect(db.exec(REVERT_C)).rejects.toThrow(
        /email_sends\.kind: the CHECK .* is not a plain list/,
      );
      expect((await kindChecks())[0]!.def).toBe(def);
      await restore();
    },
  );

  it.each([
    ['of another shape', `check (kind <> '')`],
    // The same list twice: either alone would be read, so only the count can refuse the pair.
    ['that is the same list', null],
  ])(
    'a second CHECK on the kind column (%s) stops section C: it does not choose one',
    async (_, sql) => {
      const second =
        sql ?? `check (kind in (${[...before.kinds, ...ADDED].map((k) => `'${k}'`).join(', ')}))`;
      await db.exec(
        `alter table public.email_sends add constraint email_sends_kind_second ${second}`,
      );
      const defs = await kindChecks();
      await expect(db.exec(SECTION_C)).rejects.toThrow(/email_sends\.kind: 2 CHECKs on the column/);
      await expect(db.exec(REVERT_C)).rejects.toThrow(/email_sends\.kind: 2 CHECKs on the column/);
      expect(await kindChecks()).toEqual(defs);
      await db.exec(`alter table public.email_sends drop constraint email_sends_kind_second`);
      await db.exec(SECTION_C);
      expect(await listedKinds()).toEqual([...before.kinds, ...ADDED]);
    },
  );
});
