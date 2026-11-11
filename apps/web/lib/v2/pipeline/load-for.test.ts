import { gzipSync } from 'node:zlib';
import type { PGlite } from '@electric-sql/pglite';
import { checkMap, type BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import { beforeAll, describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { accountOf, anonymousCheck, doorDb, signUp } from '../../../__tests__/v2/_lib/door-pglite';
import { FAILURE_REASONS } from '../../../../../inngest/check-events';
import type { EntitlementClock } from '../../entitlement-v2';
import { gzipJson } from './evidence';
import { loadCheck } from './load';
import { fixPlanOf, loadCheckFor, storedDrawing } from './load-for';
import type { Viewer } from './public';
import {
  FIRST,
  SECOND,
  keepSite,
  persistBuild,
  publicDeps,
  secondInput,
  type TestDeps,
} from './test-support/public-checks';
import { evidencePath } from './types';

/** After each recorded check was queued and before any of them expires. */
const NOW = Date.parse('2026-11-07T00:00:00Z');
const anonymous: Viewer = { userId: null };

describe('loadCheckFor: the five states', () => {
  let db: PGlite;
  let deps: TestDeps;

  beforeAll(async () => {
    db = await doorDb();
    deps = publicDeps(db, () => NOW);
  }, 120_000);

  it('answers null for an id that names no check', async () => {
    expect(
      await loadCheckFor(deps, '00000000-0000-4000-8000-000000000000', anonymous),
    ).toBeNull();
  });

  it('a queued check is waiting, with what its row holds', async () => {
    const { checkId } = await anonymousCheck(db, 'queued.example', new Date(NOW + 60_000));
    const read = await loadCheckFor(deps, checkId, anonymous);
    expect(read).toMatchObject({
      state: 'waiting',
      checkId,
      host: 'queued.example',
      status: 'queued',
      startedAt: null,
      progress: null,
      kept: false,
    });
  });

  it('a running check is waiting, with its progress; a deferred one is waiting', async () => {
    const running = await anonymousCheck(db, 'running.example', new Date(NOW + 60_000));
    const progress = {
      steps: [{ phase: 'crawl', state: 'now' }],
      pages_crawled: 7,
      pages_estimated: null,
      links_found: 12,
      elapsed_ms: 900,
      recent_fetches: [],
    };
    await db.query(
      `update public.checks set status = 'running', started_at = now(), heartbeat_at = now(),
              inngest_run_id = 'run', progress = $2::jsonb where id = $1`,
      [running.checkId, JSON.stringify(progress)],
    );
    expect(await loadCheckFor(deps, running.checkId, anonymous)).toMatchObject({
      state: 'waiting',
      status: 'running',
      progress,
    });

    const deferred = await anonymousCheck(db, 'deferred.example', new Date(NOW + 60_000));
    await db.query(
      `update public.checks set status = 'deferred', deferred_until = now() where id = $1`,
      [deferred.checkId],
    );
    expect(await loadCheckFor(deps, deferred.checkId, anonymous)).toMatchObject({
      state: 'waiting',
      status: 'deferred',
    });
  });

  it.each(FAILURE_REASONS)('a check failed as %s is failed with that reason', async (reason) => {
    const { checkId } = await anonymousCheck(db, `${reason}.example`, new Date(NOW + 60_000));
    await db.query(
      `update public.checks set status = 'failed', failure_reason = $2,
              started_at = '2026-11-06T11:59:00Z', finished_at = '2026-11-06T12:00:00Z'
        where id = $1`,
      [checkId, reason],
    );
    const read = await loadCheckFor(deps, checkId, anonymous);
    expect(read).toMatchObject({ state: 'failed', reason, kept: false });
    expect(read?.state === 'failed' && Date.parse(read.failedAt)).toBe(
      Date.parse('2026-11-06T12:00:00Z'),
    );
  });

  it('an expired check is expired whatever its status, at the instant it expires and after', async () => {
    const expiry = new Date(NOW - 1);
    const queued = await anonymousCheck(db, 'expired-queued.example', expiry);
    const atTheInstant = await anonymousCheck(db, 'expired-now.example', new Date(NOW));
    const failed = await anonymousCheck(db, 'expired-failed.example', expiry);
    await db.query(
      `update public.checks set status = 'failed', failure_reason = 'internal',
              started_at = now(), finished_at = now()
        where id = $1`,
      [failed.checkId],
    );
    for (const { checkId } of [queued, atTheInstant, failed]) {
      const read = await loadCheckFor(deps, checkId, anonymous);
      expect(read?.state).toBe('expired');
    }
    const oneMsEarlier = publicDeps(db, () => NOW - 1);
    expect((await loadCheckFor(oneMsEarlier, atTheInstant.checkId, anonymous))?.state).toBe(
      'waiting',
    );
  });
});

describe('loadCheckFor: a finished check built by the engine and persisted', () => {
  let db: PGlite;
  let deps: TestDeps;
  let first: BuiltCheck;
  let second: BuiltCheck;
  let owner: string;
  let stranger: string;

  beforeAll(async () => {
    db = await doorDb();
    deps = publicDeps(db, () => NOW);
    first = await persistBuild(db, deps.evidence, recordedBuild());
    second = await persistBuild(db, deps.evidence, secondInput(first), {
      siteSeeded: true,
      map: false,
    });
    owner = await signUp(db, 'owner@example.com');
    stranger = await signUp(db, 'stranger@example.com');
  }, 180_000);

  it('is ready for a visitor: the dataset loadCheck reads, on the Free plan, with the stored drawing', async () => {
    const read = await loadCheckFor(deps, FIRST, anonymous);
    if (read?.state !== 'ready') throw new Error(`expected ready, got ${read?.state}`);
    expect(read).toMatchObject({
      checkId: FIRST,
      host: 'built-site.test',
      kept: false,
      plan: 'free',
    });
    expect(read.dataset).toEqual(await loadCheck(deps.read, FIRST));
    expect(read.dataset.checks.map((c) => c.id)).toEqual([FIRST]);
    // Independently computed: the drawing the engine makes of the built check's own rows.
    expect(read.map).toEqual(checkMap(first.page_results, first.link_edges));
    expect(read.map!.nodes.length).toBeGreaterThan(5);
  });

  it("a re-check carries the site's earlier check, which its fixes and previous_check_id name", async () => {
    const read = await loadCheckFor(deps, SECOND, anonymous);
    if (read?.state !== 'ready') throw new Error(`expected ready, got ${read?.state}`);
    expect(read.dataset.checks.map((c) => c.id)).toEqual([FIRST, SECOND]);
    expect(second.check.previous_check_id).toBe(FIRST);
    const firstSeen = new Set(read.dataset.fixes.map((f) => f.first_seen_check_id));
    expect(firstSeen.has(FIRST)).toBe(true);
    const ids = new Set(read.dataset.checks.map((c) => c.id));
    expect([...firstSeen].filter((id) => !ids.has(id))).toEqual([]);
    // The rest is what loadCheck reads of the second check.
    const { checks: _checks, ...rest } = read.dataset;
    const { checks: _own, ...loaded } = await loadCheck(deps.read, SECOND);
    expect(rest).toEqual(loaded);
    // No drawing was stored for it.
    expect(read.map).toBeNull();
  });

  it('the earlier check does not carry the later one', async () => {
    const read = await loadCheckFor(deps, FIRST, anonymous);
    expect(read?.state === 'ready' && read.dataset.checks.map((c) => c.id)).toEqual([FIRST]);
  });

  it('answers map: null for a drawing that is missing, not gzip, not JSON, or of another shape', async () => {
    const path = evidencePath({ accountId: null, siteId: first.check.site_id, checkId: FIRST }, 'map');
    const stored = deps.evidence.objects.get(path)!;
    const drawing = checkMap(first.page_results, first.link_edges);
    const [anyNode] = drawing.nodes;
    const { [anyNode!.id]: _dropped, ...positionsLessOne } = drawing.positions;
    const cases: Record<string, Uint8Array | null> = {
      missing: null,
      'not gzip': new TextEncoder().encode('{"version":1}'),
      'not JSON': gzipSync(Buffer.from('not json')),
      'another version': gzipJson({ ...drawing, version: 2 }),
      'a node with no position': gzipJson({ ...drawing, positions: positionsLessOne }),
      'a node of an unknown kind': gzipJson({
        ...drawing,
        nodes: [{ ...anyNode, kind: 'hub' }, ...drawing.nodes.slice(1)],
      }),
    };
    try {
      for (const [name, bytes] of Object.entries(cases)) {
        if (bytes === null) deps.evidence.objects.delete(path);
        else deps.evidence.objects.set(path, bytes);
        const read = await loadCheckFor(deps, FIRST, anonymous);
        expect(read?.state === 'ready' ? read.map : name, name).toBeNull();
      }
    } finally {
      deps.evidence.objects.set(path, stored);
    }
    expect(await storedDrawing(deps.evidence, path)).toEqual(drawing);
    expect(await storedDrawing(deps.evidence, null)).toBeNull();
  });

  describe('once an account keeps the site', () => {
    let accountId: string;
    beforeAll(async () => {
      accountId = (await accountOf(db, owner)).id;
      await keepSite(db, first.check.site_id, accountId);
    });

    it('its member reads it, kept, on the plan of the account', async () => {
      const read = await loadCheckFor(deps, SECOND, { userId: owner });
      expect(read).toMatchObject({ state: 'ready', kept: true });
      const expected = await deps.planOf(accountId);
      expect(read?.state === 'ready' && read.plan).toBe(expected);
    });

    it("a visitor, and another account's member, get null", async () => {
      expect(await loadCheckFor(deps, FIRST, anonymous)).toBeNull();
      expect(await loadCheckFor(deps, FIRST, { userId: stranger })).toBeNull();
      expect(await loadCheckFor(deps, SECOND, { userId: stranger })).toBeNull();
    });

    it('a member whose seat is removed gets null', async () => {
      expect((await loadCheckFor(deps, FIRST, { userId: owner }))?.state).toBe('ready');
      await db.query(
        `update public.seats set status = 'removed', removed_at = now() where user_id = $1`,
        [owner],
      );
      try {
        expect(await loadCheckFor(deps, FIRST, { userId: owner })).toBeNull();
      } finally {
        await db.query(
          `update public.seats set status = 'active', removed_at = null where user_id = $1`,
          [owner],
        );
      }
    });

    it('asks for the plan of the account that keeps the site, and never for an unkept check', async () => {
      const asked: string[] = [];
      const spying = {
        ...deps,
        planOf: async (id: string) => {
          asked.push(id);
          return 'pro' as const;
        },
      };
      const kept = await loadCheckFor(spying, FIRST, { userId: owner });
      expect(kept?.state === 'ready' && kept.plan).toBe('pro');
      expect(asked).toEqual([accountId]);
      const unkept = await anonymousCheck(db, 'unkept.example', new Date(NOW + 60_000));
      await loadCheckFor(spying, unkept.checkId, anonymous);
      expect(asked).toEqual([accountId]);
    });
  });
});

describe('fixPlanOf', () => {
  const at = new Date('2026-11-07T00:00:00Z');
  const clock = (over: Partial<EntitlementClock>): EntitlementClock => ({
    state: 'free',
    tier: 'free',
    pastDueTier: null,
    pastDueSince: null,
    trialVariant: null,
    trialEndsAt: null,
    ...over,
  });

  it.each([
    ['a Free account', clock({}), 'free'],
    ['a Pro account', clock({ state: 'pro', tier: 'pro' }), 'pro'],
    ['an Agency account', clock({ state: 'agency', tier: 'agency' }), 'pro'],
    [
      'a no-card trial before its end',
      clock({
        state: 'pro_trial',
        tier: 'pro',
        trialVariant: 'no_card',
        trialEndsAt: new Date('2026-11-08T00:00:00Z'),
      }),
      'pro',
    ],
    [
      'a no-card trial at its end',
      clock({ state: 'pro_trial', tier: 'pro', trialVariant: 'no_card', trialEndsAt: at }),
      'free',
    ],
  ] as const)('%s opens %s', (_name, account, plan) => {
    expect(fixPlanOf(account, at)).toBe(plan);
  });
});
