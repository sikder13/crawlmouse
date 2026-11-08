import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import fc from 'fast-check';
import { FixTypeSchema } from '@crawlmouse/types/v2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { next } from '../lib/billing/state-machine';
import { toTransitionParams } from '../lib/billing/state-machine-apply';
import { EMAIL_MONTHS, RECENT_DAYS, RECENT_TRIALS_REFUSED_AT } from '../lib/auth/ledger';
import { catalogSnapshot } from './helpers/catalog-snapshot';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { before, seedWorld, through } from './helpers/v2-check-tables';
import { accountOf, doorDb, pgliteEntitlementStore, signUp } from './v2/_lib/door-pglite';

/**
 * Migration 006c (docs/specs/v2/06c-trial-function.md): `start_trial_with_ledger`, its two helpers,
 * and the site_fixes CHECKs, against PGlite with every migration applied in order.
 *
 * The ledger rule's expected verdicts are written out by hand at each window edge, or computed in
 * this file from UTC date fields (`expectedRefusals`); neither reads the SQL or lib/auth.
 *
 * PGlite has one backend, so two transactions never overlap here: the locks are shown to be HELD and
 * taken in ORDER, and each race's sequential outcome is shown. Two real transactions racing are
 * scripts/db/trial-race.test.ts, which runs against CI's Postgres service.
 */

const MIGRATION = '20261108000001_v2_006c_trial_function_and_checks.sql';
const ROLLBACK = '20261108000001_v2_006c_trial_function_and_checks.revert.sql';
const CHECKS_DIR = resolve(__dirname, '../../../infra/supabase/checks');
/** The advisory lock class the trial ledger's locks use (two-key form): 0x06C0. */
const LOCK_CLASS = 1728;

type Kind = 'email' | 'device' | 'ip24';
interface Hash {
  kind: Kind;
  value_hash: string;
}
const hex = (tag: string) => createHash('sha256').update(tag).digest('hex');
const h = (kind: Kind, tag: string): Hash => ({ kind, value_hash: hex(`${kind}:${tag}`) });

let db: PGlite;
beforeAll(async () => {
  db = await doorDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

/** The p_transition `first-login.ts` sends: next()'s trial_started, through toTransitionParams. */
async function transitionFor(d: PGlite, accountId: string, at = new Date()) {
  const stored = (await pgliteEntitlementStore(d).load(accountId))!;
  const t = next(stored.snapshot, { type: 'trial_started', at, variant: 'no_card' });
  expect(t.outcome).toBe('applied');
  return { event: 'trial_started', ...toTransitionParams(accountId, stored.version, t.state, at) };
}

async function freshAccount(d: PGlite, tag: string) {
  const userId = await signUp(d, `${tag}-${Math.random().toString(36).slice(2)}@example.com`);
  return (await accountOf(d, userId)).id;
}

type Outcome = { outcome: string; hits: string[] };
async function start(
  d: PGlite,
  accountId: string,
  hashes: unknown,
  transition: unknown,
): Promise<Outcome> {
  const { rows } = await asRole(d, 'service_role', null, (tx) =>
    tx.query<{ r: Outcome }>(
      `select public.start_trial_with_ledger($1, $2::jsonb, $3::jsonb) as r`,
      [accountId, JSON.stringify(hashes), JSON.stringify(transition)],
    ),
  );
  return rows[0]!.r;
}

async function ledgerOf(d: PGlite, accountId: string) {
  const { rows } = await d.query<{ kind: string; value_hash: string; trial_kind: string }>(
    `select kind, value_hash, trial_kind from public.trial_ledger where account_id = $1 order by kind`,
    [accountId],
  );
  return rows;
}

async function accountRow(d: PGlite, accountId: string) {
  const { rows } = await d.query<{
    state: string;
    trial_used_at: Date | null;
    trial_variant: string | null;
    entitlement_version: number;
  }>(
    `select state, trial_used_at, trial_variant, entitlement_version from public.accounts where id = $1`,
    [accountId],
  );
  return rows[0]!;
}

/** Prior trials of another account, `ages` before the database's clock (an interval string each). */
async function priorRows(d: PGlite, rows: { hash: Hash; age: string }[]) {
  const other = await freshAccount(d, 'prior');
  for (const r of rows) {
    await d.query(
      `insert into public.trial_ledger (kind, value_hash, account_id, trial_kind, created_at)
       values ($1, $2, $3, 'pro', now() - $4::interval)`,
      [r.hash.kind, r.hash.value_hash, other, r.age],
    );
  }
}

// ─── The ledger rule, `trial_ledger_refusals(p_hashes, p_now)` ─────────────────────────────────────

interface LedgerRow {
  kind: Kind | 'hostname';
  value_hash: string;
  at: Date;
}

/** The helper's verdict over `rows`, at `now`, in a transaction rolled back afterwards. */
async function refusals(
  hashes: Hash[],
  rows: LedgerRow[],
  now: Date,
  timeZone = 'UTC',
): Promise<string[]> {
  let out: string[] = [];
  await db.transaction(async (tx: Transaction) => {
    await tx.query(`select set_config('TimeZone', $1, true)`, [timeZone]);
    for (const r of rows) {
      await tx.query(
        `insert into public.trial_ledger (kind, value_hash, trial_kind, created_at)
         values ($1, $2, 'pro', $3)`,
        [r.kind, r.value_hash, r.at],
      );
    }
    const { rows: res } = await tx.query<{ r: string[] }>(
      `select public.trial_ledger_refusals($1::jsonb, $2) as r`,
      [JSON.stringify(hashes), now],
    );
    out = res[0]!.r;
    await tx.rollback();
  });
  return out;
}

const at = (iso: string) => new Date(iso);
const ms = (d: Date, delta: number) => new Date(d.getTime() + delta);
const SEC = 1000;
const DAY = 86_400_000;

const EMAIL = h('email', 'ada@example.com');
const DEVICE = h('device', 'browser-1');
const IP = h('ip24', '203.0.113.0/24');
const ALL = [EMAIL, DEVICE, IP];

describe('the ledger rule at its edges, by hand', () => {
  const row = (hash: Hash, when: Date): LedgerRow => ({ ...hash, at: when });

  it('email: 12 calendar months, the boundary instant excluded', async () => {
    const now = at('2025-03-31T12:00:00.000Z');
    expect(await refusals(ALL, [row(EMAIL, at('2024-03-31T12:00:00.000Z'))], now)).toEqual([]);
    expect(await refusals(ALL, [row(EMAIL, at('2024-03-31T12:00:00.001Z'))], now)).toEqual([
      'email',
    ]);
  });

  it('email: 29 February clamps to 28 February a year earlier', async () => {
    const now = at('2024-02-29T12:00:00.000Z');
    expect(await refusals(ALL, [row(EMAIL, at('2023-02-28T12:00:00.000Z'))], now)).toEqual([]);
    // 365 days back would be 2023-03-01T12:00Z, and would not count this row.
    expect(await refusals(ALL, [row(EMAIL, at('2023-02-28T12:00:00.001Z'))], now)).toEqual([
      'email',
    ]);
  });

  it('email: calendar months, not 365 days, across a leap day', async () => {
    const now = at('2025-02-28T12:00:00.000Z');
    // 12 months back is 2024-02-28T12:00Z; 365 days back would be 2024-02-29T12:00Z.
    expect(await refusals(ALL, [row(EMAIL, at('2024-02-28T12:00:00.000Z'))], now)).toEqual([]);
    expect(await refusals(ALL, [row(EMAIL, at('2024-02-28T18:00:00.000Z'))], now)).toEqual([
      'email',
    ]);
  });

  it('email: the months are counted in UTC, whatever the session time zone', async () => {
    // New York: now is 08:00 EDT; 12 local months back is 2024-03-09 08:00 EST = 13:00Z.
    const now = at('2025-03-09T12:00:00.000Z');
    const r = [row(EMAIL, at('2024-03-09T12:30:00.000Z'))];
    expect(await refusals(ALL, r, now, 'America/New_York')).toEqual(['email']);
  });

  it('device: two rows in the last 30 days refuse; the boundary instant is outside', async () => {
    const now = at('2025-06-15T12:00:00.000Z');
    const recent = row(DEVICE, ms(now, -DAY));
    expect(await refusals(ALL, [recent, row(DEVICE, ms(now, -30 * DAY))], now)).toEqual([]);
    expect(await refusals(ALL, [recent, row(DEVICE, ms(now, -30 * DAY + SEC))], now)).toEqual([
      'device',
    ]);
    expect(await refusals(ALL, [recent, row(DEVICE, ms(now, -30 * DAY - SEC))], now)).toEqual([]);
  });

  it('device: one row does not refuse, two do', async () => {
    const now = at('2025-06-15T12:00:00.000Z');
    expect(await refusals(ALL, [row(DEVICE, ms(now, -DAY))], now)).toEqual([]);
    expect(
      await refusals(ALL, [row(DEVICE, ms(now, -DAY)), row(DEVICE, ms(now, -2 * DAY))], now),
    ).toEqual(['device']);
  });

  it('device: 30 days is 720 hours, not 30 local days across a DST change', async () => {
    // New York: 30 local days before 2025-03-20 08:00 EDT is 2025-02-18 08:00 EST = 13:00Z;
    // 720 hours before is 12:00Z.
    const now = at('2025-03-20T12:00:00.000Z');
    const r = [row(DEVICE, at('2025-02-18T12:30:00.000Z')), row(DEVICE, ms(now, -DAY))];
    expect(await refusals(ALL, r, now, 'America/New_York')).toEqual(['device']);
  });

  it('ip24: two rows refuse only with a row of this device in the same 30 days', async () => {
    const now = at('2025-06-15T12:00:00.000Z');
    const ips = [row(IP, ms(now, -DAY)), row(IP, ms(now, -2 * DAY))];
    expect(await refusals(ALL, ips, now)).toEqual([]);
    expect(await refusals(ALL, [...ips, row(DEVICE, ms(now, -5 * DAY))], now)).toEqual(['ip24']);
    expect(await refusals(ALL, [...ips, row(DEVICE, ms(now, -31 * DAY))], now)).toEqual([]);
    const otherDevice = h('device', 'browser-2');
    expect(await refusals(ALL, [...ips, row(otherDevice, ms(now, -5 * DAY))], now)).toEqual([]);
  });

  it('ip24: one row with a device row does not refuse', async () => {
    const now = at('2025-06-15T12:00:00.000Z');
    const r = [row(IP, ms(now, -DAY)), row(DEVICE, ms(now, -5 * DAY))];
    expect(await refusals(ALL, r, now)).toEqual([]);
  });

  it('ip24: with no device hash sent, the network never refuses', async () => {
    const now = at('2025-06-15T12:00:00.000Z');
    const r = [row(IP, ms(now, -DAY)), row(IP, ms(now, -2 * DAY)), row(DEVICE, ms(now, -DAY))];
    expect(await refusals([EMAIL, IP], r, now)).toEqual([]);
  });

  it('a row of another kind under the same hash never counts; hostname rows are not read', async () => {
    const now = at('2025-06-15T12:00:00.000Z');
    const r: LedgerRow[] = [
      { kind: 'device', value_hash: EMAIL.value_hash, at: ms(now, -DAY) },
      { kind: 'hostname', value_hash: EMAIL.value_hash, at: ms(now, -DAY) },
      { kind: 'email', value_hash: DEVICE.value_hash, at: ms(now, -DAY) },
      { kind: 'email', value_hash: DEVICE.value_hash, at: ms(now, -2 * DAY) },
    ];
    expect(await refusals(ALL, r, now)).toEqual([]);
  });

  it('every kind refusing at once is reported in the order email, device, ip24', async () => {
    const now = at('2025-06-15T12:00:00.000Z');
    const r = [
      row(IP, ms(now, -DAY)),
      row(IP, ms(now, -DAY)),
      row(DEVICE, ms(now, -DAY)),
      row(DEVICE, ms(now, -DAY)),
      row(EMAIL, ms(now, -DAY)),
    ];
    expect(await refusals(ALL, r, now)).toEqual(['email', 'device', 'ip24']);
  });
});

describe("the ledger rule's numbers are the ones lib/auth/ledger.ts names for the spec", () => {
  it(`${RECENT_TRIALS_REFUSED_AT} device rows within ${RECENT_DAYS} days refuse, one fewer does not`, async () => {
    const now = at('2025-06-15T12:00:00.000Z');
    const inside = (i: number) => ({ ...DEVICE, at: ms(now, -RECENT_DAYS * DAY + (i + 1) * SEC) });
    const enough = Array.from({ length: RECENT_TRIALS_REFUSED_AT }, (_, i) => inside(i));
    expect(await refusals(ALL, enough, now)).toEqual(['device']);
    expect(await refusals(ALL, enough.slice(1), now)).toEqual([]);
    const outside = { ...DEVICE, at: ms(now, -RECENT_DAYS * DAY) };
    expect(await refusals(ALL, [...enough.slice(1), outside], now)).toEqual([]);
  });

  it(`an email row ${EMAIL_MONTHS} months and 1 ms old does not refuse; 1 ms younger does`, async () => {
    const now = at('2025-07-15T09:30:00.000Z');
    const edge = new Date(Date.UTC(2025, 6 - EMAIL_MONTHS, 15, 9, 30));
    expect(await refusals(ALL, [{ ...EMAIL, at: edge }], now)).toEqual([]);
    expect(await refusals(ALL, [{ ...EMAIL, at: ms(edge, 1) }], now)).toEqual(['email']);
  });
});

/** The rule restated from UTC date fields, independently of the SQL and of lib/auth. */
function expectedRefusals(hashes: Hash[], rows: LedgerRow[], now: Date): string[] {
  const y = now.getUTCFullYear() - 1;
  const m = now.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const yearStart = Date.UTC(
    y,
    m,
    Math.min(now.getUTCDate(), lastDay),
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds(),
    now.getUTCMilliseconds(),
  );
  const recentStart = now.getTime() - 30 * 24 * 3600 * 1000;
  const sent = (k: Kind) => hashes.find((x) => x.kind === k);
  const n = (k: Kind, since: number) => {
    const s = sent(k);
    return s
      ? rows.filter((r) => r.kind === k && r.value_hash === s.value_hash && r.at.getTime() > since)
          .length
      : 0;
  };
  const out: string[] = [];
  if (n('email', yearStart) > 0) out.push('email');
  if (n('device', recentStart) >= 2) out.push('device');
  if (n('ip24', recentStart) >= 2 && n('device', recentStart) >= 1) out.push('ip24');
  return out;
}

describe('the ledger rule over generated ledgers', () => {
  it('trial_ledger_refusals equals the rule restated in this file', async () => {
    const other = h('device', 'someone-else');
    const edgeOffsets = [0, 1, -1, SEC, -SEC];
    const ageArb = fc.oneof(
      fc.integer({ min: 0, max: 400 * DAY }),
      fc.constantFrom(...edgeOffsets).map((o) => 30 * DAY + o),
      fc.constantFrom('year-edge' as const),
    );
    const nowArb = fc
      .date({ min: new Date('2024-01-01T00:00:00Z'), max: new Date('2027-12-31T00:00:00Z') })
      .filter((d) => !Number.isNaN(d.getTime()));
    const kindArb = fc.constantFrom<LedgerRow['kind']>('email', 'device', 'ip24', 'hostname');
    const hashArb = fc.constantFrom(EMAIL, DEVICE, IP, other).map((x) => x.value_hash);
    const rowArb = fc.record({
      kind: kindArb,
      value_hash: hashArb,
      age: ageArb,
      edge: fc.constantFrom(...edgeOffsets),
    });
    await fc.assert(
      fc.asyncProperty(
        nowArb,
        fc.array(rowArb, { maxLength: 7 }),
        fc.subarray([DEVICE, IP]),
        fc.constantFrom('UTC', 'America/New_York', 'Pacific/Auckland'),
        async (now, gen, extra, zone) => {
          const hashes = [EMAIL, ...extra];
          const rows: LedgerRow[] = gen.map((g) => {
            if (g.age === 'year-edge') {
              const y = now.getUTCFullYear() - 1;
              const last = new Date(Date.UTC(y, now.getUTCMonth() + 1, 0)).getUTCDate();
              const edge = Date.UTC(
                y,
                now.getUTCMonth(),
                Math.min(now.getUTCDate(), last),
                now.getUTCHours(),
                now.getUTCMinutes(),
                now.getUTCSeconds(),
                now.getUTCMilliseconds(),
              );
              return { kind: g.kind, value_hash: g.value_hash, at: new Date(edge + g.edge) };
            }
            return { kind: g.kind, value_hash: g.value_hash, at: ms(now, -g.age) };
          });
          expect(await refusals(hashes, rows, now, zone)).toEqual(
            expectedRefusals(hashes, rows, now),
          );
        },
      ),
      { numRuns: 150 },
    );
  }, 300_000);
});

// ─── start_trial_with_ledger, end to end ───────────────────────────────────────────────────────────

describe('start_trial_with_ledger starts the trial and writes its rows in one call', () => {
  it('started: pro_trial, no_card, trial_used_at set, one pro row per hash for the account', async () => {
    const id = await freshAccount(db, 'started');
    const hashes = [h('email', 'started'), h('device', 'started'), h('ip24', 'started')];
    const before = await accountRow(db, id);
    expect(await start(db, id, hashes, await transitionFor(db, id))).toEqual({
      outcome: 'started',
      hits: [],
    });
    const a = await accountRow(db, id);
    expect(a.state).toBe('pro_trial');
    expect(a.trial_variant).toBe('no_card');
    expect(a.trial_used_at).not.toBeNull();
    expect(a.entitlement_version).toBe(before.entitlement_version + 1);
    expect(await ledgerOf(db, id)).toEqual(
      [...hashes]
        .sort((x, y) => x.kind.localeCompare(y.kind))
        .map((x) => ({ ...x, trial_kind: 'pro' })),
    );
  });

  it('refused: the kinds that refused, nothing written, still free', async () => {
    const id = await freshAccount(db, 'refused');
    const email = h('email', 'refused');
    await priorRows(db, [{ hash: email, age: '1 day' }]);
    const before = await accountRow(db, id);
    expect(await start(db, id, [email], await transitionFor(db, id))).toEqual({
      outcome: 'refused',
      hits: ['email'],
    });
    expect(await accountRow(db, id)).toEqual(before);
    expect(await ledgerOf(db, id)).toEqual([]);
  });

  it("the windows are read at the database's own clock", async () => {
    const id1 = await freshAccount(db, 'clock-in');
    const d1 = h('device', 'clock-in');
    await priorRows(db, [
      { hash: d1, age: '1 day' },
      { hash: d1, age: '30 days -1 minute' },
    ]);
    expect(
      (await start(db, id1, [h('email', 'clock-in'), d1], await transitionFor(db, id1))).outcome,
    ).toBe('refused');
    const id2 = await freshAccount(db, 'clock-out');
    const d2 = h('device', 'clock-out');
    await priorRows(db, [
      { hash: d2, age: '1 day' },
      { hash: d2, age: '30 days 1 minute' },
    ]);
    expect(
      (await start(db, id2, [h('email', 'clock-out'), d2], await transitionFor(db, id2))).outcome,
    ).toBe('started');
  });

  it('a second call for the same account after the first committed is not_eligible', async () => {
    const id = await freshAccount(db, 'twice');
    const hashes = [h('email', 'twice'), h('device', 'twice')];
    const t = await transitionFor(db, id);
    expect((await start(db, id, hashes, t)).outcome).toBe('started');
    const after = await accountRow(db, id);
    expect(await start(db, id, hashes, t)).toEqual({ outcome: 'not_eligible', hits: [] });
    expect(await accountRow(db, id)).toEqual(after);
    expect(await ledgerOf(db, id)).toHaveLength(2);
  });

  it('the third account on one device within 30 days is refused, after two committed', async () => {
    const device = h('device', 'shared-browser');
    const outcomes: string[] = [];
    for (const n of [1, 2, 3]) {
      const id = await freshAccount(db, `shared-${n}`);
      outcomes.push(
        (await start(db, id, [h('email', `shared-${n}`), device], await transitionFor(db, id)))
          .outcome,
      );
    }
    expect(outcomes).toEqual(['started', 'started', 'refused']);
  });

  it('a stale p_expected_version raises 40001 and writes nothing', async () => {
    const id = await freshAccount(db, 'stale');
    const t = await transitionFor(db, id);
    await db.query(
      `update public.accounts set entitlement_version = entitlement_version + 1 where id = $1`,
      [id],
    );
    const before = await accountRow(db, id);
    await expect(start(db, id, [h('email', 'stale')], t)).rejects.toMatchObject({ code: '40001' });
    expect(await accountRow(db, id)).toEqual(before);
    expect(await ledgerOf(db, id)).toEqual([]);
  });

  it('an account that does not exist, or is deleted, raises P0002', async () => {
    const id = await freshAccount(db, 'deleted');
    const t = await transitionFor(db, id);
    await db.query(`update public.accounts set deleted_at = now() where id = $1`, [id]);
    await expect(start(db, id, [h('email', 'deleted')], t)).rejects.toMatchObject({
      code: 'P0002',
    });
  });

  it('refuses to run outside READ COMMITTED, where the read after the lock could miss a commit', async () => {
    const id = await freshAccount(db, 'isolation');
    const t = await transitionFor(db, id);
    await expect(
      db.transaction(async (tx) => {
        await tx.exec(`set transaction isolation level repeatable read`);
        await tx.exec(`set local role service_role`);
        await tx.query(`select public.start_trial_with_ledger($1, $2::jsonb, $3::jsonb)`, [
          id,
          JSON.stringify([h('email', 'isolation')]),
          JSON.stringify(t),
        ]);
      }),
    ).rejects.toThrow(/read committed/i);
    expect((await accountRow(db, id)).state).toBe('free');
  });
});

describe('not eligible: nothing is written', () => {
  async function expectNotEligible(id: string, t: unknown) {
    const before = await accountRow(db, id);
    const ledger = await db.query(`select count(*)::int as n from public.trial_ledger`);
    expect(await start(db, id, [h('email', `ne-${id}`)], t)).toEqual({
      outcome: 'not_eligible',
      hits: [],
    });
    expect(await accountRow(db, id)).toEqual(before);
    expect(await db.query(`select count(*)::int as n from public.trial_ledger`)).toEqual(ledger);
  }

  it('an account on a trial', async () => {
    const id = await freshAccount(db, 'ne-trial');
    const t = await transitionFor(db, id);
    expect((await start(db, id, [h('email', 'ne-trial-first')], t)).outcome).toBe('started');
    await expectNotEligible(id, t);
  });

  it('a Pro account', async () => {
    const id = await freshAccount(db, 'ne-pro');
    const t = await transitionFor(db, id);
    await db.query(
      `update public.accounts
          set state = 'pro', tier = 'pro', current_subscription_id = 'sub_test',
              state_history = state_history || jsonb_build_array(jsonb_build_object(
                'state', 'pro', 'since', '2099-01-01T00:00:00.000Z'))
        where id = $1`,
      [id],
    );
    await expectNotEligible(id, t);
  });

  it('a Free account that has used its trial', async () => {
    const id = await freshAccount(db, 'ne-used');
    const t = await transitionFor(db, id);
    await db.query(`update public.accounts set trial_used_at = now() where id = $1`, [id]);
    await expectNotEligible(id, t);
  });
});

// ─── Input validation ──────────────────────────────────────────────────────────────────────────────

describe('input validation: each malformed input raises 22023 and writes nothing', () => {
  const E = h('email', 'v');
  const D = h('device', 'v');
  const I = h('ip24', 'v');
  let id: string;
  let t: Record<string, unknown>;
  beforeAll(async () => {
    id = await freshAccount(db, 'validation');
    t = await transitionFor(db, id);
  });

  const hashCases: [string, unknown][] = [
    ['an unknown kind', [E, { kind: 'hostname', value_hash: D.value_hash }]],
    ['an uppercase hash', [{ kind: 'email', value_hash: E.value_hash.toUpperCase() }]],
    ['a 63-character hash', [{ kind: 'email', value_hash: E.value_hash.slice(1) }]],
    ['a hash that is not a string', [{ kind: 'email', value_hash: 7 }]],
    ['two rows of one kind', [E, D, { ...D, value_hash: hex('another') }]],
    ['four rows', [E, D, I, E]],
    ['no rows', []],
    ['no email row', [D, I]],
    ['an element with an extra key', [{ ...E, account_id: id }]],
    ['an element missing value_hash', [{ kind: 'email' }]],
    ['an element that is not an object', ['email']],
    ['not an array', { kind: 'email', value_hash: E.value_hash }],
    ['null', null],
  ];
  it.each(hashCases)('p_hashes: %s', async (_name, hashes) => {
    const before = await accountRow(db, id);
    await expect(start(db, id, hashes, t)).rejects.toMatchObject({ code: '22023' });
    expect(await accountRow(db, id)).toEqual(before);
    expect(await ledgerOf(db, id)).toEqual([]);
  });

  const transitionCases: [string, (t: Record<string, unknown>) => unknown][] = [
    ['another event', (t) => ({ ...t, event: 'checkout_completed' })],
    ['no event', ({ event: _e, ...rest }) => rest],
    ['another account', (t) => ({ ...t, p_account_id: '00000000-0000-4000-8000-000000000000' })],
    ['another state', (t) => ({ ...t, p_state: 'pro' })],
    ['another tier', (t) => ({ ...t, p_tier: 'agency' })],
    ['the card variant', (t) => ({ ...t, p_trial_variant: 'card_required' })],
    ['a subscription id', (t) => ({ ...t, p_subscription_id: 'sub_123' })],
    ['a past-due tier', (t) => ({ ...t, p_past_due_tier: 'pro' })],
    ['a past-due date', (t) => ({ ...t, p_past_due_since: '2026-01-01T00:00:00.000Z' })],
    ['a dispute date', (t) => ({ ...t, p_disputed_at: '2026-01-01T00:00:00.000Z' })],
    ['no trial end', (t) => ({ ...t, p_trial_ends_at: null })],
    ['no trial-used date', (t) => ({ ...t, p_trial_used_at: null })],
    ['a trial end that is not a date', (t) => ({ ...t, p_trial_ends_at: 'soon' })],
    ['a version that is not an integer', (t) => ({ ...t, p_expected_version: 1.5 })],
    ['a version given as a string', (t) => ({ ...t, p_expected_version: '0' })],
    ['a limit too large for an integer', (t) => ({ ...t, p_site_limit: 1e12 })],
    ['a missing key', ({ p_seat_limit: _s, ...rest }) => rest],
    ['an extra key', (t) => ({ ...t, p_extra: 1 })],
    ['not an object', () => ['trial_started']],
    ['null', () => null],
  ];
  it.each(transitionCases)('p_transition: %s', async (_name, edit) => {
    const before = await accountRow(db, id);
    await expect(start(db, id, [E], edit(t))).rejects.toMatchObject({ code: '22023' });
    expect(await accountRow(db, id)).toEqual(before);
    expect(await ledgerOf(db, id)).toEqual([]);
  });

  it('anti-vacuity: the unedited inputs start the trial', async () => {
    expect((await start(db, id, [E, D, I], t)).outcome).toBe('started');
  });
});

// ─── Locks ─────────────────────────────────────────────────────────────────────────────────────────

/** A hash's lock key: its first 32 bits, as Postgres reads them into an int4. */
const keyOf = (x: Hash) => parseInt(x.value_hash.slice(0, 8), 16) | 0;

describe('the locks are held for the whole call, in one order', () => {
  it('one advisory lock per hash, and the account row locked, inside the transaction', async () => {
    const id = await freshAccount(db, 'locks');
    const hashes = [h('email', 'locks'), h('device', 'locks'), h('ip24', 'locks')];
    await priorRows(db, [{ hash: hashes[0]!, age: '1 day' }]); // refused: nothing updates the row
    const t = await transitionFor(db, id);
    await db.transaction(async (tx) => {
      await tx.exec(`set local role service_role`);
      const { rows } = await tx.query<{ r: Outcome }>(
        `select public.start_trial_with_ledger($1, $2::jsonb, $3::jsonb) as r`,
        [id, JSON.stringify(hashes), JSON.stringify(t)],
      );
      expect(rows[0]!.r.outcome).toBe('refused');
      await tx.exec(`reset role`);
      const locks = await tx.query<{ classid: number; objid: number }>(
        `select classid::int8 as classid, objid::int8 as objid from pg_locks
          where locktype = 'advisory' and pid = pg_backend_pid() and objsubid = 2`,
      );
      expect(locks.rows.map((l) => Number(l.objid)).sort((a, b) => a - b)).toEqual(
        hashes.map((x) => keyOf(x) >>> 0).sort((a, b) => a - b),
      );
      expect(new Set(locks.rows.map((l) => Number(l.classid)))).toEqual(new Set([LOCK_CLASS]));
      const row = await tx.query<{ locked: boolean }>(
        `select xmax::text = txid_current()::text as locked from public.accounts where id = $1`,
        [id],
      );
      expect(row.rows[0]!.locked, 'the account row is locked FOR UPDATE').toBe(true);
      await tx.rollback();
    });
  });

  it('trial_ledger_lock takes the keys in ascending order, whatever the order sent', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 3, maxLength: 3 }),
        fc.shuffledSubarray([0, 1, 2], { minLength: 3, maxLength: 3 }),
        async (tags, order) => {
          const hashes: Hash[] = [h('email', tags[0]!), h('device', tags[1]!), h('ip24', tags[2]!)];
          const sent = order.map((i) => hashes[i]!);
          let taken: number[] = [];
          await db.transaction(async (tx) => {
            const { rows } = await tx.query<{ k: number[] }>(
              `select public.trial_ledger_lock($1::jsonb) as k`,
              [JSON.stringify(sent)],
            );
            taken = rows[0]!.k;
            await tx.rollback();
          });
          const want = [...new Set(hashes.map(keyOf))].sort((a, b) => a - b);
          expect(taken).toEqual(want);
        },
      ),
      { numRuns: 40 },
    );
  }, 120_000);
});

describe('atomicity: a failure after the transition leaves neither the trial nor a row', () => {
  it('an insert that fails after the transition rolls the transition back', async () => {
    const d = await doorDb();
    try {
      const id = await freshAccount(d, 'atomic');
      const t = await transitionFor(d, id);
      await d.exec(`
        create function public.test_refuse_ledger() returns trigger language plpgsql as $f$
        begin raise exception 'injected failure' using errcode = 'XX999'; end; $f$;
        create trigger test_refuse_ledger before insert on public.trial_ledger
          for each row execute function public.test_refuse_ledger();`);
      const before = await accountRow(d, id);
      await expect(start(d, id, [h('email', 'atomic')], t)).rejects.toMatchObject({
        code: 'XX999',
      });
      expect(await accountRow(d, id)).toEqual(before);
      expect(await ledgerOf(d, id)).toEqual([]);
    } finally {
      await d.close();
    }
  });
});

// ─── Grants ────────────────────────────────────────────────────────────────────────────────────────

const CALLS = {
  start_trial_with_ledger: `select public.start_trial_with_ledger(gen_random_uuid(), '[]', '{}')`,
  trial_ledger_lock: `select public.trial_ledger_lock('[]')`,
  trial_ledger_refusals: `select public.trial_ledger_refusals('[]', now())`,
} as const;

describe('grants: only service_role may start a trial, and no role may call the helpers', () => {
  it.each(['anon', 'authenticated'] as const)('%s may execute none of the three', async (role) => {
    for (const sql of Object.values(CALLS)) {
      await expect(
        asRole(db, role, null, (tx) => tx.query(sql)),
        sql,
      ).rejects.toThrow(/permission denied for function/);
    }
  });

  it('service_role may execute start_trial_with_ledger and neither helper', async () => {
    await expect(
      asRole(db, 'service_role', null, (tx) => tx.query(CALLS.start_trial_with_ledger)),
    ).rejects.toMatchObject({ code: '22023' }); // past the grant, refused by validation
    for (const sql of [CALLS.trial_ledger_lock, CALLS.trial_ledger_refusals]) {
      await expect(
        asRole(db, 'service_role', null, (tx) => tx.query(sql)),
        sql,
      ).rejects.toThrow(/permission denied for function/);
    }
  });

  it('the function is SECURITY DEFINER with an empty search_path and a lock timeout; the helpers are not', async () => {
    const { rows } = await db.query<{
      name: string;
      definer: boolean;
      config: string[] | null;
      owner: string;
      volatility: string;
    }>(
      `select p.proname as name, p.prosecdef as definer, p.proconfig as config,
              pg_get_userbyid(p.proowner) as owner, p.provolatile as volatility
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1) order by p.proname`,
      [Object.keys(CALLS)],
    );
    expect(rows).toEqual([
      {
        name: 'start_trial_with_ledger',
        definer: true,
        config: ['search_path=""', 'lock_timeout=3s'],
        owner: 'postgres',
        volatility: 'v',
      },
      {
        name: 'trial_ledger_lock',
        definer: false,
        config: ['search_path=""'],
        owner: 'postgres',
        volatility: 'v',
      },
      {
        name: 'trial_ledger_refusals',
        definer: false,
        config: ['search_path=""'],
        owner: 'postgres',
        volatility: 's',
      },
    ]);
  });

  it.each(['06-client-functions.sql', '08-v1-client-grants.sql'])(
    'check %s finds nothing',
    async (file) => {
      const { rows } = await db.query(readFileSync(join(CHECKS_DIR, file), 'utf8'));
      expect(rows).toEqual([]);
    },
  );
});

// ─── The site_fixes CHECKs ─────────────────────────────────────────────────────────────────────────

describe('site_fixes.type takes every fix type of the contract and nothing else', () => {
  it('each of the contract values is stored; an unknown type is refused', async () => {
    const d = await doorDb();
    try {
      await seedWorld(d, 'fix-types');
      const { rows } = await d.query<{ id: string }>(`select id from public.site_fixes limit 1`);
      const fixId = rows[0]!.id;
      for (const type of FixTypeSchema.options) {
        await d.query(`update public.site_fixes set type = $1 where id = $2`, [type, fixId]);
      }
      await expect(
        d.query(`update public.site_fixes set type = 'not_a_fix_type' where id = $1`, [fixId]),
      ).rejects.toMatchObject({ code: '23514', constraint: 'site_fixes_type_check' });
      expect(FixTypeSchema.options).toContain('missing_schema_description');
      expect(FixTypeSchema.options).toContain('no_question_headings');
    } finally {
      await d.close();
    }
  });

  it('exactly one CHECK reads site_fixes.type, named site_fixes_type_check', async () => {
    const { rows } = await db.query<{ conname: string }>(
      `select c.conname from pg_constraint c
        where c.conrelid = 'public.site_fixes'::regclass and c.contype = 'c'
          and c.conkey = array[(select attnum from pg_attribute
                                 where attrelid = 'public.site_fixes'::regclass
                                   and attname = 'type')]::int2[]`,
    );
    expect(rows.map((r) => r.conname)).toEqual(['site_fixes_type_check']);
  });
});

// ─── Apply, re-apply, revert ───────────────────────────────────────────────────────────────────────

describe('migration 006c applies, re-applies and reverts', () => {
  it('re-applying it changes nothing in the catalog', async () => {
    const d = await freshDb();
    try {
      await applyAllMigrations(d, undefined, through(MIGRATION));
      const once = await catalogSnapshot(d);
      await d.exec(readMigration(MIGRATION));
      expect(await catalogSnapshot(d)).toEqual(once);
    } finally {
      await d.close();
    }
  }, 120_000);

  it('the revert returns the catalog to the state before 006c, twice, and 006c re-applies', async () => {
    const d = await freshDb();
    try {
      await applyAllMigrations(d, undefined, before(MIGRATION));
      const pre = await catalogSnapshot(d);
      await d.exec(readMigration(MIGRATION));
      const applied = await catalogSnapshot(d);
      expect(applied).not.toEqual(pre); // anti-vacuity
      await d.exec(readRollback(ROLLBACK));
      expect(await catalogSnapshot(d)).toEqual(pre);
      await d.exec(readRollback(ROLLBACK));
      expect(await catalogSnapshot(d)).toEqual(pre);
      await d.exec(readMigration(MIGRATION));
      expect(await catalogSnapshot(d)).toEqual(applied);
    } finally {
      await d.close();
    }
  }, 120_000);

  it('the migration finds the type CHECK by the catalog, whatever it is named', async () => {
    const d = await freshDb();
    try {
      await applyAllMigrations(d, undefined, before(MIGRATION));
      await d.exec(
        `alter table public.site_fixes rename constraint site_fixes_type_check to fix_type_was_here`,
      );
      await d.exec(readMigration(MIGRATION));
      const { rows } = await d.query<{ conname: string }>(
        `select conname from pg_constraint
          where conrelid = 'public.site_fixes'::regclass and conname in ('fix_type_was_here', 'site_fixes_type_check')`,
      );
      expect(rows.map((r) => r.conname)).toEqual(['site_fixes_type_check']);
    } finally {
      await d.close();
    }
  }, 120_000);

  it('the revert refuses while a fix holds a type the old CHECK does not know', async () => {
    const d = await freshDb();
    try {
      await applyAllMigrations(d, undefined, through(MIGRATION));
      await seedWorld(d, 'revert-006c');
      await d.exec(`update public.site_fixes set type = 'no_question_headings'`);
      await expect(d.exec(readRollback(ROLLBACK))).rejects.toMatchObject({ code: '23514' });
    } finally {
      await d.close();
    }
  }, 120_000);
});
