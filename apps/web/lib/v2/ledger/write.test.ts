/**
 * The ledger writer over the migrated schema (PGlite), through the production store
 * (`supabaseLedgerStore` over the PostgREST stand-in): what it writes, what it refuses to write, that
 * nothing of the account, the check or the site's address reaches the ledger, and the backfill's
 * window. The draft's own rules are draft.test.ts's.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import {
  insertRow,
  LINEAGE,
  prepareMeasurement,
  ROWS,
  seedWorld,
  type World,
} from '../../../__tests__/helpers/v2-check-tables';
import type { LedgerDraft } from './draft';
import { putLedgerDraft, supabaseLedgerStore } from './store';
import {
  BACKFILL_EVERY_HOURS,
  BACKFILL_MINUTE,
  backfillLedger,
  backfillSlot,
  writeLedger,
  type LedgerStore,
} from './write';

/** A test-only key: the bytes 00, 11, … ff, twice (32 bytes), as hex. */
const SECRET = Array.from({ length: 16 }, (_, i) => (i * 0x11).toString(16).padStart(2, '0'))
  .join('')
  .repeat(2);
const HOST = 'shop.distinctive-client-name.co.uk';

const DRAFT: LedgerDraft = {
  cms: 'shopify',
  frontend_framework: 'shopify_liquid',
  edge_vendor: 'cloudflare',
  without_js_state: 'partial',
  share_2xx: 0.75,
  share_3xx: 0.25,
  share_4xx: 0,
  share_5xx: 0,
  share_unanswered: 0,
  signals_detected: ['schema_org'],
  signals_indeterminate: [],
  observations: [
    { crawler: 'GPTBot', verdict: 'allowed', cause: null, robots_rule: 'wildcard_partial' },
    {
      crawler: 'ClaudeBot',
      verdict: 'blocked_by_ua_rule',
      cause: 'cloudflare_1020',
      robots_rule: 'no_group',
    },
  ],
};

let db: PGlite;
let world: World;
let store: LedgerStore;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  await prepareMeasurement(db);
  world = await seedWorld(db, 'ledger');
  store = supabaseLedgerStore(postgrestOver(db));
}, 120_000);

async function endedCheck(
  opts: { accountId?: string | null; status?: string; draft?: boolean; host?: string } = {},
): Promise<string> {
  const site = randomUUID();
  const check = randomUUID();
  const accountId = opts.accountId === undefined ? world.accountId : opts.accountId;
  await insertRow(
    db,
    'sites',
    ROWS.sites(site, accountId, opts.host ?? `${site.slice(0, 8)}.${HOST}`),
  );
  const row = ROWS.checks(check, site);
  await insertRow(
    db,
    'checks',
    opts.status === 'failed'
      ? {
          ...row,
          status: 'failed',
          failure_reason: 'timeout',
          lineage_id: null,
          coverage: null,
          technical_seo: null,
          ai_readability: null,
        }
      : opts.status
        ? {
            ...row,
            status: opts.status,
            started_at: null,
            tested_at: null,
            finished_at: null,
            lineage_id: null,
            coverage: null,
            technical_seo: null,
            ai_readability: null,
          }
        : row,
  );
  if (opts.draft !== false) await putLedgerDraft(postgrestOver(db), check, DRAFT);
  return check;
}

const count = async (sql: string, params: unknown[]) =>
  (await db.query<{ n: number }>(sql, params)).rows[0]!.n;

const draftsOf = (check: string) =>
  count(`select count(*)::int as n from public.check_ledger_drafts where check_id = $1`, [check]);

describe('writeLedger', () => {
  it('writes the run, one observation per crawler and the link, and deletes the draft', async () => {
    const check = await endedCheck();
    expect(await writeLedger({ store, secret: SECRET }, check)).toBe('written');
    const { rows } = await db.query<Record<string, unknown>>(
      `select r.observed_month::text as month, r.site_key_version, r.lineage_id, r.cms,
              r.share_2xx::float8 as s2, (select count(*)::int from research.crawler_observations o
                                           where o.run_id = r.id) as obs
         from research.check_runs r join public.check_ledger_links l on l.run_id = r.id
        where l.check_id = $1`,
      [check],
    );
    expect(rows).toEqual([
      {
        month: '2026-10-01',
        site_key_version: 1,
        lineage_id: LINEAGE,
        cms: 'shopify',
        s2: 0.75,
        obs: 2,
      },
    ]);
    expect(await draftsOf(check)).toBe(0);
  });

  it('a second write of the same check writes nothing', async () => {
    const check = await endedCheck();
    await writeLedger({ store, secret: SECRET }, check);
    expect(await writeLedger({ store, secret: SECRET }, check)).toBe('already_linked');
    expect(
      await count(`select count(*)::int as n from public.check_ledger_links where check_id = $1`, [
        check,
      ]),
    ).toBe(1);
  });

  it('writes nothing of the account, the user, the check or the site address', async () => {
    const check = await endedCheck();
    await writeLedger({ store, secret: SECRET }, check);
    const { rows: users } = await db.query<{ id: string; email: string }>(
      `select id::text, email from public.users where id = $1`,
      [world.ownerId],
    );
    const { rows: site } = await db.query<{ id: string; host: string }>(
      `select s.id::text, s.host from public.sites s join public.checks c on c.site_id = s.id where c.id = $1`,
      [check],
    );
    const forbidden = [
      world.accountId,
      world.ownerId,
      users[0]!.email,
      check,
      site[0]!.id,
      site[0]!.host,
      'distinctive-client-name',
      'https://',
    ].map((v) => v.toLowerCase());
    const { rows } = await db.query<{ v: string }>(
      `select to_jsonb(r)::text as v from research.check_runs r
         join public.check_ledger_links l on l.run_id = r.id where l.check_id = $1
       union all
       select to_jsonb(o)::text from research.crawler_observations o
         join public.check_ledger_links l on l.run_id = o.run_id where l.check_id = $1`,
      [check],
    );
    expect(rows.length).toBe(3);
    for (const { v } of rows) {
      for (const f of forbidden) expect(v.toLowerCase(), f).not.toContain(f);
      // No time finer than a month: the only date is the first of a month, and nothing has a time.
      expect(v).not.toMatch(/\d{2}:\d{2}/);
      for (const d of v.match(/\d{4}-\d{2}-\d{2}/g) ?? []) expect(d.endsWith('-01'), d).toBe(true);
    }
  });

  it('writes an anonymous check', async () => {
    const check = await endedCheck({ accountId: null });
    expect(await writeLedger({ store, secret: SECRET }, check)).toBe('written');
  });

  it('writes nothing for an internal account, and drops the draft', async () => {
    const internalWorld = await seedWorld(db, 'ledger-internal');
    await db.query(`update public.accounts set internal = true where id = $1`, [
      internalWorld.accountId,
    ]);
    const check = await endedCheck({ accountId: internalWorld.accountId });
    expect(await writeLedger({ store, secret: SECRET }, check)).toBe('internal');
    expect(await draftsOf(check)).toBe(0);
    expect(
      await count(`select count(*)::int as n from public.check_ledger_links where check_id = $1`, [
        check,
      ]),
    ).toBe(0);
  });

  it.each([
    [undefined, 'no_key'],
    ['', 'no_key'],
    ['not-hex', 'no_key'],
  ])('writes nothing with RESEARCH_SITE_KEY %j', async (secret, outcome) => {
    const check = await endedCheck();
    expect(await writeLedger({ store, secret }, check)).toBe(outcome);
    expect(await draftsOf(check)).toBe(1);
  });

  it('writes nothing for a check that has not ended, has failed, or has no draft', async () => {
    expect(
      await writeLedger({ store, secret: SECRET }, await endedCheck({ status: 'queued' })),
    ).toBe('not_ended');
    expect(
      await writeLedger({ store, secret: SECRET }, await endedCheck({ status: 'failed' })),
    ).toBe('not_ended');
    expect(await writeLedger({ store, secret: SECRET }, await endedCheck({ draft: false }))).toBe(
      'no_draft',
    );
    expect(await writeLedger({ store, secret: SECRET }, randomUUID())).toBe('gone');
  });
});

describe('the draft goes with its check', () => {
  it('the anonymous expiry’s delete takes the draft with the site and its checks', async () => {
    const check = await endedCheck({ accountId: null });
    await db.query(
      `update public.checks set expires_at = now() - interval '1 hour' where id = $1`,
      [check],
    );
    const { rows } = await db.query<{ site_id: string }>(
      `select site_id::text from public.checks where id = $1`,
      [check],
    );
    const deleted = await db.query(
      `select public.delete_expired_unkept_sites(array[$1]::uuid[], now(), now() + interval '1 day')`,
      [rows[0]!.site_id],
    );
    expect(deleted.rows.length).toBe(1);
    expect(await draftsOf(check)).toBe(0);
  });
});

describe('backfillLedger', () => {
  const at = async (check: string, iso: string) =>
    db.query(`update public.check_ledger_drafts set created_at = $2 where check_id = $1`, [
      check,
      iso,
    ]);

  it('the slot is the latest scheduled run at or before now, and the cron is that schedule', () => {
    expect(backfillSlot(new Date('2026-11-20T12:41:00Z')).toISOString()).toBe(
      '2026-11-20T12:41:00.000Z',
    );
    expect(backfillSlot(new Date('2026-11-20T12:40:59Z')).toISOString()).toBe(
      '2026-11-20T06:41:00.000Z',
    );
    expect(backfillSlot(new Date('2026-11-20T18:40:00Z')).toISOString()).toBe(
      '2026-11-20T12:41:00.000Z',
    );
    expect(backfillSlot(new Date('2026-11-21T00:41:00Z')).toISOString()).toBe(
      '2026-11-21T00:41:00.000Z',
    );
    const fn = readFileSync(join(__dirname, '../../../../../inngest/ledger.ts'), 'utf8');
    expect(fn).toContain(`{ cron: '${BACKFILL_MINUTE} */${BACKFILL_EVERY_HOURS} * * *' }`);
  });

  it('writes the drafts stored in the six hours that ended an hour before its slot, even when it starts late', async () => {
    // Slot 12:41: the window is [05:41, 11:41). The run starts 40 minutes late.
    const now = new Date('2026-11-20T13:21:00Z');
    const inside = await endedCheck();
    const tooNew = await endedCheck();
    const tooOld = await endedCheck();
    const edge = await endedCheck();
    await at(inside, '2026-11-20T10:30:00Z');
    await at(tooNew, '2026-11-20T11:41:00Z');
    await at(tooOld, '2026-11-20T05:40:59Z');
    await at(edge, '2026-11-20T05:41:00Z');
    const failures: string[] = [];
    const r = await backfillLedger(
      { store, secret: SECRET, onFailure: (id) => failures.push(id) },
      now,
    );
    expect(r).toEqual({ outcomes: { written: 2 }, failed: 0, bounded: false });
    expect(failures).toEqual([]);
    expect(await draftsOf(inside)).toBe(0);
    expect(await draftsOf(edge)).toBe(0);
    expect(await draftsOf(tooNew)).toBe(1);
    expect(await draftsOf(tooOld)).toBe(1);
  });

  it('counts a failure without stopping, says when the window held more than its bound, and drops a spent draft', async () => {
    const now = new Date('2026-11-21T12:41:00Z');
    const a = await endedCheck();
    const b = await endedCheck();
    const c = await endedCheck();
    await at(a, '2026-11-21T06:10:00Z');
    await at(b, '2026-11-21T08:20:00Z');
    await at(c, '2026-11-21T10:30:00Z');
    const failing: LedgerStore = {
      ...store,
      record: async (id, run, obs) => {
        if (id === a) throw new Error('boom');
        return store.record(id, run, obs);
      },
    };
    const failures: string[] = [];
    const r = await backfillLedger(
      { store: failing, secret: SECRET, onFailure: (id) => failures.push(id) },
      now,
      2,
    );
    expect(r).toEqual({ outcomes: { written: 1 }, failed: 1, bounded: true });
    expect(failures).toEqual([a]);
    // The failed retry was the one retry: its draft goes. The one past the bound stays.
    expect(await draftsOf(a)).toBe(0);
    expect(await draftsOf(c)).toBe(1);
  });

  it('drops the draft of a check the retry finds not ended', async () => {
    const now = new Date('2026-11-23T12:41:00Z');
    const queued = await endedCheck({ status: 'queued' });
    await at(queued, '2026-11-23T08:00:00Z');
    const r = await backfillLedger({ store, secret: SECRET, onFailure: () => {} }, now);
    expect(r.outcomes).toEqual({ not_ended: 1 });
    expect(await draftsOf(queued)).toBe(0);
  });

  it('drops the draft of a check the retry finds already linked', async () => {
    const now = new Date('2026-11-22T12:41:00Z');
    const linked = await endedCheck();
    await writeLedger({ store, secret: SECRET }, linked);
    await putLedgerDraft(postgrestOver(db), linked, DRAFT);
    await at(linked, '2026-11-22T08:00:00Z');
    const r = await backfillLedger({ store, secret: SECRET, onFailure: () => {} }, now);
    expect(r.outcomes).toEqual({ already_linked: 1 });
    expect(await draftsOf(linked)).toBe(0);
  });
});
