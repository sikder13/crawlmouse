import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GATES } from '../../entitlement-v2';
import type { Capture } from './events';
import { markDone, type MarkDoneDeps } from './fixes';
import { supabaseFixesStore } from './fixes-store';
import type { RecheckOutcome, RecheckRequest } from './recheck';
import { clients, fixWorld, makePro, type FixWorld } from './test-support/fix-world';

/**
 * Mark done (CC-26b D5) once the route has established membership: lib/v2/account/fixes.ts over
 * PGlite through the PostgREST stand-in, with the re-check request a fake (workstream A implements
 * it). The route's own guards (flag, session, `is_member_for_fix`) are tested with the route file.
 */

let fw: FixWorld;
let db: PGlite;
beforeAll(async () => {
  fw = await fixWorld();
}, 120_000);
afterAll(async () => {
  await fw?.db.close();
});

let asked: RecheckRequest[];
let recheck: RecheckOutcome;
let captured: Parameters<Capture>[];
beforeEach(async () => {
  db = (await fw.db.clone()) as PGlite;
  asked = [];
  captured = [];
  recheck = { queued: true, checkId: randomUUID(), created: true };
});
afterEach(async () => {
  await db.close();
});

function deps(userId: string): MarkDoneDeps {
  const { session, admin } = clients(db, userId);
  return {
    session,
    store: supabaseFixesStore(admin),
    capture: (async (...args: Parameters<Capture>) => {
      captured.push(args);
    }) as Capture,
    now: () => new Date(),
    requestRecheck: async (req) => {
      asked.push(req);
      return recheck;
    },
  };
}

const mark = (userId: string, fixId: string, kind: 'json' | 'form' = 'json') =>
  markDone(deps(userId), { fixId, userId }, kind);
const answer = async (res: Response) => [res.status, await res.json()];

async function state(fixId: string) {
  const fix = await db.query<{ status: string }>(
    `select status from public.site_fixes where id = $1`,
    [fixId],
  );
  const events = await db.query<{ kind: string; by_seat_id: string | null }>(
    `select kind, by_seat_id from public.fix_events where fix_id = $1 order by at`,
    [fixId],
  );
  return { status: fix.rows[0]!.status, events: events.rows };
}

describe('markDone', () => {
  it('a developer seat marks a visible fix: the mark, its event, one fix_marked_done and a fix re-check', async () => {
    const fix = fw.ranked[0]!;
    expect(await answer(await mark(fw.w.scopedUserId, fix))).toEqual([
      200,
      { status: 'marked_done', recheck },
    ]);
    expect(await state(fix)).toEqual({
      status: 'marked_done',
      events: [{ kind: 'marked_done', by_seat_id: fw.w.scopedSeatId }],
    });
    expect(captured).toEqual([['fix_marked_done', fw.w.accountId, { type: 'orphan_pages' }]]);
    expect(asked).toEqual([
      {
        siteId: fw.w.site1,
        trigger: 'fix_recheck',
        cap: GATES.free.manualChecksPerSiteDay,
        requestedByUserId: fw.w.scopedUserId,
      },
    ]);
  });

  it('a form is sent to the site’s page', async () => {
    const res = await mark(fw.w.ownerId, fw.ranked[1]!, 'form');
    expect([res.status, res.headers.get('location')]).toEqual([303, `/sites/${fw.w.site1}`]);
  });

  it('marking again writes no second event and sends no second fix_marked_done, and asks for the re-check again', async () => {
    const fix = fw.ranked[0]!;
    await mark(fw.w.ownerId, fix);
    expect((await mark(fw.w.ownerId, fix)).status).toBe(200);
    expect((await state(fix)).events).toHaveLength(1);
    expect(captured).toHaveLength(1);
    expect(asked).toHaveLength(2);
  });

  it('402 fixesVisible for a fix Free does not open: no mark, no event, no re-check', async () => {
    const fix = fw.ranked[3]!;
    expect(await answer(await mark(fw.w.ownerId, fix))).toEqual([
      402,
      { error: 'upgrade_required', gate: 'fixesVisible' },
    ]);
    expect(await state(fix)).toEqual({ status: 'open', events: [] });
    expect(captured).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('on Pro the same fix is marked, and the re-check carries Pro’s cap', async () => {
    await makePro(db, fw.w.accountId);
    expect((await mark(fw.w.ownerId, fw.ranked[3]!)).status).toBe(200);
    expect(asked.map((a) => a.cap)).toEqual([GATES.pro.manualChecksPerSiteDay]);
  });

  it('409 not_markable for a verified fix, and no re-check', async () => {
    const fix = fw.ranked[2]!;
    await db.query(
      `update public.site_fixes set status = 'verified_resolved', last_state = 'not_detected', rank = null
        where id = $1`,
      [fix],
    );
    // Verified, it is no longer among the fixes Free opens; Pro sees it.
    await makePro(db, fw.w.accountId);
    expect(await answer(await mark(fw.w.ownerId, fix))).toEqual([
      409,
      { error: 'not_markable', status: 'verified_resolved' },
    ]);
    expect(asked).toEqual([]);
  });

  it('the mark stands whatever the re-check answers, and the answer says what it was', async () => {
    for (const outcome of [
      { queued: false, reason: 'capped', nextAllowedAt: '2026-11-11T09:00:00.000Z' },
      { queued: false, reason: 'check_running', checkId: randomUUID() },
      { queued: false, reason: 'paused' },
    ] as RecheckOutcome[]) {
      recheck = outcome;
      const fix = await freshOpenFix();
      expect(await answer(await mark(fw.w.ownerId, fix))).toEqual([
        200,
        { status: 'marked_done', recheck: outcome },
      ]);
      expect((await state(fix)).status).toBe('marked_done');
    }
  });

  it('404 for a fix of a removed site, and for a caller with no seat on the fix’s account', async () => {
    expect(await answer(await mark(fw.stranger.ownerId, fw.ranked[0]!))).toEqual([
      404,
      { error: 'not_found' },
    ]);
    await db.query(`update public.sites set removed_at = now() where id = $1`, [fw.w.site1]);
    expect(await answer(await mark(fw.w.ownerId, fw.ranked[0]!))).toEqual([
      404,
      { error: 'not_found' },
    ]);
    expect(asked).toEqual([]);
    expect((await state(fw.ranked[0]!)).status).toBe('open');
  });

  it('reads the gates of the fix’s own account, not the caller’s default (one user, a Free and a Pro account)', async () => {
    // The stranger's owner also sits on the Pro account as a developer.
    await makePro(db, fw.w.accountId);
    await db.query(
      `insert into public.seats (id, account_id, user_id, invited_email, role, status, accepted_at)
       values (gen_random_uuid(), $1, $2, 'both@example.com', 'developer', 'active', now())`,
      [fw.w.accountId, fw.stranger.ownerId],
    );
    expect((await mark(fw.stranger.ownerId, fw.ranked[4]!)).status).toBe(200);
    const theirOwn = fw.stranger.seeded.site_fixes.find((r) => r.scope === 'site1')!.pk
      .id as string;
    // Their own Free account's fix: its only fix carries a verified event, so Free opens none.
    expect(await answer(await mark(fw.stranger.ownerId, theirOwn))).toEqual([
      402,
      { error: 'upgrade_required', gate: 'fixesVisible' },
    ]);
    expect(asked.map((a) => a.cap)).toEqual([GATES.pro.manualChecksPerSiteDay]);
  });
});

/** A new open fix of site1, ordered first (rank 1, the lowest number yet), so Free opens it. */
async function freshOpenFix(): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into public.site_fixes
       select (jsonb_populate_record(f, jsonb_build_object(
                 'id', $1::uuid, 'fingerprint', left(md5($1::text), 16),
                 'number', 4000 - (select count(*) from public.site_fixes)))).*
         from public.site_fixes f where f.id = $2`,
    [id, fw.ranked[0]],
  );
  return id;
}
