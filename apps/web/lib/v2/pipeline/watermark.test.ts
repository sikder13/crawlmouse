import type { PGlite } from '@electric-sql/pglite';
import { buildCheck, type BuildInput, type BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import type { BatchResult, Fix, FixEvent } from '@crawlmouse/types/v2';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import type { Capture } from '../account/events';
import { pageVantage, persistBuiltCheck, readOfFixes } from './persist';
import { fixEventFromRow, fixFromRow } from './rows';
import { pglitePersistDb, seedRunning, seedSite } from './test-support/pglite';
import { SECOND, secondCrawl, secondInput, type SecondTimes } from './test-support/second-check';
import type { PersistOutcome } from './types';

/**
 * The persist watermark (CC-26b D5, plan revision R5 and R7; migration 20261112000001 section B):
 * a check's result for a fix is written only when the fix's last event is still the one its build
 * read. The site is the recorded site, kept by an account; its first check is persisted, a member
 * marks a fix done with mark_fix_done, and the second check (test-support/second-check.ts) is built
 * either from the fixes as they were before the mark (its build read the fix before the mark) or as
 * the table holds them after it (its build read the mark). The mark is stamped with the database's
 * clock, so the second check's times are set after it: the engine ignores a measurement older than a
 * mark (diff.ts), which is not what these tests are about.
 */

const vantageOf = (batches: readonly unknown[]) =>
  pageVantage((batches as BatchResult[]).flatMap((b) => (b.kind === 'crawl' ? b.pages : [])));

let base: PGlite;
let first: BuiltCheck;
let accountId: string;
let seatId: string;
let times: SecondTimes;
/** The second check unmarked, to choose the fixes each case marks. */
let plain: BuiltCheck;

const plus = (ms: number) => new Date(Date.now() + ms).toISOString();

beforeAll(async () => {
  const recorded = recordedBuild();
  base = await freshDb();
  await applyAllMigrations(base);
  const owner = await signUp(base, 'owner@watermark.test');
  ({ accountId, seatId } = await personalAccount(base, owner));
  const site = { ...recorded.site, account_id: accountId };
  first = buildCheck({ ...recorded, site });
  await seedSite(base, site);
  await seedRunning(base, recorded.check);
  await persistBuiltCheck(
    pglitePersistDb(base),
    { built: first, vantage: vantageOf(recorded.batches), map_path: null, read: [] },
    async () => undefined,
  );
  times = {
    queued_at: plus(60_000),
    started_at: plus(62_000),
    finished_at: plus(600_000),
    expires_at: plus(30 * 86_400_000),
  };
  plain = buildCheck(inputFor(first.fixes, first.fix_events));
}, 120_000);
afterAll(async () => {
  await base?.close();
});

function inputFor(fixes: Fix[], events: FixEvent[]): BuildInput {
  const input = secondInput(first, times, { fixes, events });
  return { ...input, site: { ...input.site, account_id: accountId } };
}

/**
 * An open fix of the first check that the second, unmarked, leaves with `status` and `lastState`
 * (of `type`, when given).
 */
function fixThatGoes(status: Fix['status'], lastState: Fix['last_state'], type?: Fix['type']): Fix {
  const after = plain.fixes.find(
    (f) =>
      f.status === status &&
      f.last_state === lastState &&
      (type === undefined || f.type === type) &&
      first.fixes.some((g) => g.id === f.id && g.status === 'open'),
  );
  if (!after) throw new Error(`no first-check fix goes ${status}/${lastState} on the second`);
  return first.fixes.find((f) => f.id === after.id)!;
}

async function markDone(db: PGlite, fixId: string): Promise<unknown> {
  const { rows } = await db.query<{ r: unknown }>(`select public.mark_fix_done($1, $2) as r`, [
    fixId,
    seatId,
  ]);
  return rows[0]!.r;
}

/** The site's fixes and their events as the table holds them: what a build reads. */
async function tableRead(db: PGlite): Promise<{ fixes: Fix[]; events: FixEvent[] }> {
  const fixes = await db.query<{ row: Record<string, unknown> }>(
    `select to_jsonb(f) as row from public.site_fixes f where f.site_id = $1 order by f.id`,
    [first.check.site_id],
  );
  const events = await db.query<{ row: Record<string, unknown> }>(
    `select to_jsonb(e) as row from public.fix_events e
       join public.site_fixes f on f.id = e.fix_id where f.site_id = $1 order by e.id`,
    [first.check.site_id],
  );
  return {
    fixes: fixes.rows.map((r) => fixFromRow(r.row)),
    events: events.rows.map((r) => fixEventFromRow(r.row)),
  };
}

interface Run {
  db: PGlite;
  built: BuiltCheck;
  outcome: PersistOutcome;
  capture: ReturnType<typeof vi.fn>;
}

/**
 * Marks `marked` on a copy of the database, builds the second check from the fixes as they were
 * before the mark (`readsMark` false) or after it, and persists it with what that build read.
 */
async function run(marked: Fix, readsMark: boolean): Promise<Run> {
  const db = (await base.clone()) as PGlite;
  const before = { fixes: first.fixes, events: first.fix_events };
  expect(await markDone(db, marked.id)).toMatchObject({ outcome: 'marked' });
  const read = readsMark ? await tableRead(db) : before;
  const built = buildCheck(inputFor(read.fixes, read.events));
  await seedRunning(db, inputFor(read.fixes, read.events).check);
  const capture = vi.fn(async () => undefined);
  const outcome = await persistBuiltCheck(
    pglitePersistDb(db),
    {
      built,
      vantage: vantageOf(secondCrawl()),
      map_path: null,
      read: readOfFixes(read.fixes, read.events),
    },
    capture as unknown as Capture,
  );
  return { db, built, outcome, capture };
}

async function fixRow(db: PGlite, id: string) {
  const { rows } = await db.query<Record<string, unknown>>(
    `select status, last_state, rank, last_measured_check_id, before_after
       from public.site_fixes where id = $1`,
    [id],
  );
  return rows[0]!;
}

const rowsOf = async (db: PGlite, table: 'fix_events' | 'changes', fixId: string) =>
  (
    await db.query<{ kind: string }>(
      `select kind from public.${table} where fix_id = $1 and check_id = $2`,
      [fixId, SECOND],
    )
  ).rows.map((r) => r.kind);

describe('the second check this file builds (what the cases rely on)', () => {
  it('verifies the orphan fix, keeps a fix detected and leaves the crawler-access fix indeterminate', () => {
    expect(fixThatGoes('verified_resolved', 'not_detected', 'orphan_pages')).toBeDefined();
    expect(fixThatGoes('open', 'detected')).toBeDefined();
    expect(fixThatGoes('open', 'indeterminate')).toBeDefined();
  });
});

describe('a check whose build read the fix before the mark', () => {
  let r: Run;
  let marked: Fix;
  let markedRow: Record<string, unknown>;
  beforeAll(async () => {
    marked = fixThatGoes('verified_resolved', 'not_detected', 'orphan_pages');
    r = await run(marked, false);
    markedRow = await fixRow(r.db, marked.id);
  }, 120_000);
  afterAll(async () => {
    await r?.db.close();
  });

  it('leaves the fix as the mark left it, and writes no event, change or verification for it', async () => {
    // Anti-vacuity: unwithheld, this build verifies the fix and writes a resolved change for it.
    expect(r.built.fixes.find((f) => f.id === marked.id)).toMatchObject({
      status: 'verified_resolved',
    });
    expect(r.built.changes.some((c) => c.fix_id === marked.id)).toBe(true);
    expect(markedRow).toMatchObject({
      status: 'marked_done',
      last_state: marked.last_state,
      rank: marked.rank,
      last_measured_check_id: first.check.id,
    });
    expect(await rowsOf(r.db, 'fix_events', marked.id)).toEqual([]);
    expect(await rowsOf(r.db, 'changes', marked.id)).toEqual([]);
    expect(r.outcome.verified.map((v) => v.fix_id)).not.toContain(marked.id);
    expect(r.capture).not.toHaveBeenCalledWith(
      'fix_closed',
      accountId,
      expect.objectContaining({ type: marked.type }),
    );
  });

  it('writes the rest of the check, and counts what it withheld against what it was given', () => {
    const of = (rows: { fix_id?: string | null }[]) =>
      rows.filter((x) => x.fix_id === marked.id).length;
    expect(r.outcome.written).toBe(true);
    expect(r.outcome.counts).toMatchObject({
      fixes: r.built.fixes.length - 1,
      fixes_withheld: 1,
      fix_events: r.built.fix_events.length - of(r.built.fix_events),
      fix_events_withheld: of(r.built.fix_events),
      changes: r.built.changes.length - of(r.built.changes),
      changes_withheld: of(r.built.changes),
    });
    expect(of(r.built.fix_events)).toBe(1);
  });
});

describe('a check whose build read the mark', () => {
  it('verifies a fix it no longer finds: resolved, with before and after, and one fix_closed', async () => {
    const marked = fixThatGoes('verified_resolved', 'not_detected', 'orphan_pages');
    const r = await run(marked, true);
    try {
      expect(r.outcome.counts).toMatchObject({ fixes_withheld: 0, fix_events_withheld: 0 });
      const row = await fixRow(r.db, marked.id);
      expect(row).toMatchObject({ status: 'verified_resolved', last_state: 'not_detected' });
      expect(row.before_after).toEqual(r.built.fixes.find((f) => f.id === marked.id)!.before_after);
      expect(await rowsOf(r.db, 'fix_events', marked.id)).toEqual(['verified']);
      expect(await rowsOf(r.db, 'changes', marked.id)).toEqual(['resolved']);
      expect(r.outcome.verified).toContainEqual({
        fix_id: marked.id,
        type: marked.type,
        checks_to_close: 1,
      });
      expect(r.capture).toHaveBeenCalledWith('fix_closed', accountId, {
        type: marked.type,
        checksToClose: 1,
      });
      expect(r.capture).toHaveBeenCalledTimes(r.outcome.verified.length);
    } finally {
      await r.db.close();
    }
  }, 120_000);

  it('reopens a fix it still finds', async () => {
    const marked = fixThatGoes('open', 'detected');
    const r = await run(marked, true);
    try {
      expect(await fixRow(r.db, marked.id)).toMatchObject({
        status: 'reopened',
        last_state: 'detected',
      });
      expect(await rowsOf(r.db, 'fix_events', marked.id)).toEqual(['reopened']);
      expect(r.outcome.verified.map((v) => v.fix_id)).not.toContain(marked.id);
    } finally {
      await r.db.close();
    }
  }, 120_000);

  it('gives a fix whose page left the sample unable_to_verify, never verified', async () => {
    const marked = fixThatGoes('open', 'indeterminate');
    const r = await run(marked, true);
    try {
      expect(await fixRow(r.db, marked.id)).toMatchObject({
        status: 'unable_to_verify',
        last_state: 'indeterminate',
      });
      expect(await rowsOf(r.db, 'fix_events', marked.id)).toEqual(['unable_to_verify']);
      expect(await rowsOf(r.db, 'changes', marked.id)).toEqual([]);
      expect(r.outcome.verified.map((v) => v.fix_id)).not.toContain(marked.id);
      expect(r.capture).not.toHaveBeenCalledWith(
        'fix_closed',
        accountId,
        expect.objectContaining({ type: marked.type }),
      );
    } finally {
      await r.db.close();
    }
  }, 120_000);

  it('answers no verification when persisted again, so fix_closed is sent once', async () => {
    const marked = fixThatGoes('verified_resolved', 'not_detected', 'orphan_pages');
    const r = await run(marked, true);
    try {
      expect(r.outcome.verified.length).toBeGreaterThan(0); // anti-vacuity
      const again = vi.fn(async () => undefined);
      const read = await tableRead(r.db);
      const repeat = await persistBuiltCheck(
        pglitePersistDb(r.db),
        {
          built: r.built,
          vantage: vantageOf(secondCrawl()),
          map_path: null,
          read: readOfFixes(read.fixes, read.events),
        },
        again as unknown as Capture,
      );
      expect(repeat).toEqual({ written: false, counts: {}, verified: [] });
      expect(again).not.toHaveBeenCalled();
    } finally {
      await r.db.close();
    }
  }, 120_000);
});

describe('readOfFixes', () => {
  const ev = (id: string, fix_id: string, at: string) => ({ id, fix_id, at });
  it('names each fix’s last event by time, then by id at the same instant; null for none', () => {
    const a = '00000000-0000-4000-8000-00000000000a';
    const b = '00000000-0000-4000-8000-00000000000b';
    const c = '00000000-0000-4000-8000-00000000000c';
    expect(
      readOfFixes(
        [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }],
        [
          ev(c, 'f1', '2026-11-10T10:00:00.000Z'),
          ev(a, 'f1', '2026-11-10T10:00:01.000Z'),
          ev(a, 'f2', '2026-11-10T10:00:00Z'),
          ev(b, 'f2', '2026-11-10T10:00:00.000Z'),
        ],
      ),
    ).toEqual([
      { fix_id: 'f1', last_event_id: a },
      { fix_id: 'f2', last_event_id: b },
      { fix_id: 'f3', last_event_id: null },
    ]);
  });
});
