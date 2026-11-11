/**
 * A kept site's first audit (CC-22b D7, questions Q15) on PGlite with every migration: the request
 * goes through `requestCheck` and the pipeline's SQL store, and the limiter is recorded.
 */
import type { PGlite } from '@electric-sql/pglite';
import { stableId } from '@crawlmouse/engine/v2/pipeline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountOf, doorDb, signUp } from '../../../__tests__/v2/_lib/door-pglite';
import { firstAuditId, firstAuditRequester, type FirstAuditDeps } from './first-audit';
import { sqlKeepStore } from './test-support/sql-keep-store';
import { sqlPipelineStore } from './test-support/sql-store';
import { asService } from './test-support/stored-check';

const NOW = Date.parse('2026-11-10T12:00:00.000Z');

let db: PGlite;
let n = 0;
beforeAll(async () => {
  db = await doorDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

/** A site an account keeps, with no check. */
async function keptSite(host: string): Promise<{ siteId: string; userId: string }> {
  const userId = await signUp(db, `first-${++n}@example.com`);
  const account = await accountOf(db, userId);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.sites (account_id, host) values ($1, $2) returning id`,
    [account.id, host],
  );
  return { siteId: rows[0]!.id, userId };
}

/** A limit asked: the day's ceiling, or a domain's bucket. */
type LimitCall = 'global' | `domain:${string}`;

function harness(
  over: { refuse?: 'global' | 'domain'; paused?: boolean; onLimit?: () => Promise<void> } = {},
) {
  const sent: { id: string; name: string; data: Record<string, unknown> }[] = [];
  const limits: LimitCall[] = [];
  const deps: FirstAuditDeps = {
    request: {
      store: sqlPipelineStore(db),
      send: async (event) => void sent.push(event),
      now: () => NOW,
    },
    hasLiveOrGradedCheck: (siteId) => sqlKeepStore(asService(db)).hasLiveOrGradedCheck(siteId),
    limits: {
      global: async () => {
        limits.push('global');
        await over.onLimit?.();
        return over.refuse !== 'global';
      },
      domain: async (domain) => {
        limits.push(`domain:${domain}`);
        await over.onLimit?.();
        return over.refuse !== 'domain';
      },
    },
    paused: () => over.paused === true,
  };
  return { request: firstAuditRequester(deps), sent, limits };
}

const checksOf = async (siteId: string) =>
  (
    await db.query<{ id: string; status: string; trigger: string; expires_at: Date | null }>(
      `select id, status, trigger, expires_at from public.checks where site_id = $1 order by id`,
      [siteId],
    )
  ).rows;

describe('firstAuditRequester', () => {
  it('requests one queued first_audit check under the site’s derived id, with one event', async () => {
    const { siteId, userId } = await keptSite('www.first-one.example');
    const { request, sent, limits } = harness();
    expect(await request({ siteId, host: 'www.first-one.example', userId })).toBe('requested');
    expect(await checksOf(siteId)).toEqual([
      { id: firstAuditId(siteId), status: 'queued', trigger: 'first_audit', expires_at: null },
    ]);
    // Independently of the module: the engine's stable id of ('first_audit', the site).
    expect(firstAuditId(siteId)).toBe(stableId('first_audit', siteId));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      id: `check:${siteId}:first_audit:${firstAuditId(siteId)}`,
      name: 'check.requested',
      data: {
        checkId: firstAuditId(siteId),
        siteId,
        trigger: 'first_audit',
        requestedByUserId: userId,
      },
    });
    // The day's ceiling first, then the host's bucket; www. shares the host's.
    expect(limits).toEqual(['global', 'domain:first-one.example']);
  });

  it('asked again, starts nothing and uses no bucket: the site has its check', async () => {
    const { siteId, userId } = await keptSite('again.example');
    const first = harness();
    await first.request({ siteId, host: 'again.example', userId });
    const second = harness();
    expect(await second.request({ siteId, host: 'again.example', userId })).toBe('has_check');
    expect(await checksOf(siteId)).toHaveLength(1);
    expect(second.sent).toEqual([]);
    expect(second.limits).toEqual([]);
  });

  it('two requests that both found no check make one check: the id is the site’s, not a fresh one', async () => {
    const { siteId, userId } = await keptSite('racing.example');
    const inner = harness();
    let raced = false;
    // The second request runs whole while the first is at its first bucket, after its own read.
    const outer = harness({
      onLimit: async () => {
        if (raced) return;
        raced = true;
        expect(await inner.request({ siteId, host: 'racing.example', userId })).toBe('requested');
      },
    });
    expect(await outer.request({ siteId, host: 'racing.example', userId })).toBe('has_check');
    expect(await checksOf(siteId)).toHaveLength(1);
    expect([...inner.sent, ...outer.sent].map((e) => e.id)).toEqual([
      `check:${siteId}:first_audit:${firstAuditId(siteId)}`,
      `check:${siteId}:first_audit:${firstAuditId(siteId)}`,
    ]);
  });

  it('a site whose only check failed gets its first audit', async () => {
    const { siteId, userId } = await keptSite('failed.example');
    await db.query(
      `insert into public.checks (site_id, status, trigger, grade_version, started_at, finished_at,
                                  failure_reason)
       values ($1, 'failed', 'first_audit', '2.0.0', now(), now(), 'stalled')`,
      [siteId],
    );
    expect(await harness().request({ siteId, host: 'failed.example', userId })).toBe('requested');
    expect((await checksOf(siteId)).map((c) => c.status).sort()).toEqual(['failed', 'queued']);
  });

  it('at the daily ceiling starts no check and does not reach the host’s bucket', async () => {
    const { siteId, userId } = await keptSite('capacity.example');
    const { request, sent, limits } = harness({ refuse: 'global' });
    expect(await request({ siteId, host: 'capacity.example', userId })).toBe('capacity');
    expect(await checksOf(siteId)).toEqual([]);
    expect(sent).toEqual([]);
    expect(limits).toEqual(['global']);
  });

  it('past the host’s hourly bucket starts no check', async () => {
    const { siteId, userId } = await keptSite('busy.example');
    const { request, sent } = harness({ refuse: 'domain' });
    expect(await request({ siteId, host: 'busy.example', userId })).toBe('domain_limit');
    expect(await checksOf(siteId)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('while crawls are paused starts no check and uses no bucket', async () => {
    const { siteId, userId } = await keptSite('paused.example');
    const { request, sent, limits } = harness({ paused: true });
    expect(await request({ siteId, host: 'paused.example', userId })).toBe('paused');
    expect(await checksOf(siteId)).toEqual([]);
    expect(sent).toEqual([]);
    expect(limits).toEqual([]);
  });
});
