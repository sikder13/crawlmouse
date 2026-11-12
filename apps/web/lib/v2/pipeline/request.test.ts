import { describe, expect, it } from 'vitest';
import { GRADE_VERSION } from '@crawlmouse/engine/v2/pipeline';
import { IdSchema, type Check } from '@crawlmouse/types/v2';
import { bucketedKey, checkIdOfKey } from './ids';
import { DEFAULT_PAGE_CAP } from './limits';
import { requestCheck, type RequestDeps } from './request';
import type { QueuedCheck, RequestSite } from './store';

const SITE: RequestSite = {
  id: '22222222-2222-4222-8222-222222222222',
  account_id: '33333333-3333-4333-8333-333333333333',
  host: 'shop.example.com',
  next_check_at: '2026-11-09T03:15:00+00:00',
};
// 2026-11-08T12:00:00Z is a whole number of 2-minute and 10-minute buckets.
const NOON = Date.UTC(2026, 10, 8, 12, 0, 0);

/** A store whose insert does nothing on an existing id, as `on conflict (id) do nothing` does. */
function harness(site: RequestSite = SITE) {
  const rows = new Map<string, QueuedCheck>();
  const sent: Parameters<RequestDeps['send']>[0][] = [];
  let clock = NOON;
  let ids = 0;
  const deps: RequestDeps = {
    store: {
      requestSite: async (id) => {
        expect(id).toBe(site.id);
        return site;
      },
      insertQueued: async (row) => {
        if (rows.has(row.id)) return false;
        rows.set(row.id, row);
        return true;
      },
    },
    send: async (e) => {
      sent.push(e);
    },
    now: () => clock,
    newId: () => `44444444-4444-4444-8444-${String(++ids).padStart(12, '0')}`,
  };
  return { deps, rows, sent, at: (ms: number) => (clock = ms) };
}

describe('requestCheck (D13)', () => {
  it('two manual requests in one 2-minute bucket make one row and one event id', async () => {
    const h = harness();
    const first = await requestCheck(h.deps, { siteId: SITE.id, trigger: 'manual' });
    h.at(NOON + 119_999);
    const second = await requestCheck(h.deps, { siteId: SITE.id, trigger: 'manual' });
    expect(second.checkId).toBe(first.checkId);
    expect([first.created, second.created]).toEqual([true, false]);
    expect(h.rows.size).toBe(1);
    expect(h.sent.map((e) => e.id)).toEqual([
      `check:${SITE.id}:manual:${NOON / 120_000}`,
      `check:${SITE.id}:manual:${NOON / 120_000}`,
    ]);
  });

  it('the next bucket is another check', async () => {
    const h = harness();
    const first = await requestCheck(h.deps, { siteId: SITE.id, trigger: 'manual' });
    h.at(NOON + 120_000);
    const second = await requestCheck(h.deps, { siteId: SITE.id, trigger: 'manual' });
    expect(second.checkId).not.toBe(first.checkId);
    expect(h.rows.size).toBe(2);
  });

  it('keys a scheduled request on next_check_at, whatever the time', async () => {
    const h = harness();
    const a = await requestCheck(h.deps, { siteId: SITE.id, trigger: 'scheduled' });
    h.at(NOON + 3_600_000);
    const b = await requestCheck(h.deps, { siteId: SITE.id, trigger: 'scheduled' });
    expect(b.checkId).toBe(a.checkId);
    expect(h.sent[0]!.id).toBe(`check:${SITE.id}:scheduled:2026-11-09T03:15:00.000Z`);
  });

  it('refuses a scheduled request for a site with no next_check_at', async () => {
    const h = harness({ ...SITE, next_check_at: null });
    await expect(requestCheck(h.deps, { siteId: SITE.id, trigger: 'scheduled' })).rejects.toThrow(
      /no next_check_at/,
    );
    expect(h.sent).toEqual([]);
  });

  it('keys re-checks and deploys on their own buckets', () => {
    const k = { siteId: SITE.id, kept: true, now: NOON + 599_999, nextCheckAt: null };
    expect(bucketedKey({ ...k, trigger: 'fix_recheck' })).toBe(
      `check:${SITE.id}:recheck:${Math.floor((NOON + 599_999) / 120_000)}`,
    );
    expect(bucketedKey({ ...k, trigger: 'deploy' })).toBe(
      `check:${SITE.id}:deploy:${NOON / 600_000}`,
    );
    expect(bucketedKey({ ...k, trigger: 'first_audit' })).toBeNull();
  });

  it('gives an audit nobody keeps a fresh check, keyed by its id, that expires in 24 hours', async () => {
    const h = harness({ ...SITE, account_id: null, next_check_at: null });
    const a = await requestCheck(h.deps, { siteId: SITE.id, trigger: 'manual' });
    const b = await requestCheck(h.deps, { siteId: SITE.id, trigger: 'manual' });
    expect(a.checkId).not.toBe(b.checkId);
    expect(h.sent.map((e) => e.id)).toEqual([`check:anon:${a.checkId}`, `check:anon:${b.checkId}`]);
    expect(h.rows.get(a.checkId)!.expires_at).toBe('2026-11-09T12:00:00.000Z');
  });

  it('writes the queued row and the event the run reads', async () => {
    const h = harness();
    const { checkId } = await requestCheck(h.deps, {
      siteId: SITE.id,
      trigger: 'manual',
      requestedByUserId: 'u1',
    });
    expect(h.rows.get(checkId)).toEqual({
      id: checkId,
      site_id: SITE.id,
      trigger: 'manual',
      grade_version: GRADE_VERSION,
      queued_at: '2026-11-08T12:00:00.000Z',
      heartbeat_at: '2026-11-08T12:00:00.000Z',
      expires_at: null,
    });
    expect(h.sent[0]).toMatchObject({
      name: 'check.requested',
      data: {
        checkId,
        siteId: SITE.id,
        accountId: SITE.account_id,
        host: 'shop.example.com',
        // The engine's canonical spelling: canonicalizeUrl drops the root path's slash.
        homepageUrl: 'https://shop.example.com',
        trigger: 'manual',
        pageCap: DEFAULT_PAGE_CAP,
        requestedByUserId: 'u1',
      },
    });
  });

  it('a bucketed request retried after its send failed finds its row and sends the same event id (correctness 7)', async () => {
    const h = harness();
    const send = h.deps.send;
    h.deps.send = async () => {
      throw new Error('send failed');
    };
    await expect(requestCheck(h.deps, { siteId: SITE.id, trigger: 'manual' })).rejects.toThrow(
      'send failed',
    );
    h.deps.send = send;
    const retry = await requestCheck(h.deps, { siteId: SITE.id, trigger: 'manual' });
    expect(retry.created).toBe(false);
    expect(h.rows.size).toBe(1);
    expect(h.sent.map((e) => e.id)).toEqual([`check:${SITE.id}:manual:${NOON / 120_000}`]);
  });

  it('a first audit retried after its send failed writes a second row and sends a second event id (correctness 7)', async () => {
    const h = harness();
    const send = h.deps.send;
    h.deps.send = async () => {
      throw new Error('send failed');
    };
    await expect(requestCheck(h.deps, { siteId: SITE.id, trigger: 'first_audit' })).rejects.toThrow(
      'send failed',
    );
    h.deps.send = send;
    const retry = await requestCheck(h.deps, { siteId: SITE.id, trigger: 'first_audit' });
    expect(retry.created).toBe(true);
    expect(h.rows.size).toBe(2);
    expect(h.sent.map((e) => e.id)).toEqual([`check:${SITE.id}:first_audit:${retry.checkId}`]);
  });

  it('derives a version-8 UUID from the key that the contract accepts', () => {
    const id = checkIdOfKey(`check:${SITE.id}:manual:1`);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(IdSchema.safeParse(id).success).toBe(true);
    expect(checkIdOfKey(`check:${SITE.id}:manual:1`)).toBe(id);
    expect(checkIdOfKey(`check:${SITE.id}:manual:2`)).not.toBe(id);
  });
});

describe('requestCheck: the next bucket for a re-check whose bucket’s check has started (D11)', () => {
  const B = NOON / 120_000;
  /** The harness with a `checkStatus` that reads the statuses set here. */
  function withStatus(statuses: Record<string, Check['status']>) {
    const h = harness();
    const asked: string[] = [];
    h.deps.store.checkStatus = async (id) => {
      asked.push(id);
      return statuses[id] ?? null;
    };
    return { ...h, asked };
  }

  it.each([
    ['manual', 'manual', 'running'],
    ['manual', 'manual', 'finished'],
    ['fix_recheck', 'recheck', 'running'],
    ['fix_recheck', 'recheck', 'failed'],
  ] as const)(
    '%s (key word %s), its bucket’s check %s → the next bucket',
    async (trigger, word, status) => {
      const current = checkIdOfKey(`check:${SITE.id}:${word}:${B}`);
      const h = withStatus({ [current]: status });
      const got = await requestCheck(h.deps, { siteId: SITE.id, trigger });
      const nextKey = `check:${SITE.id}:${word}:${B + 1}`;
      expect(got).toEqual({ checkId: checkIdOfKey(nextKey), created: true });
      expect(h.sent.map((e) => e.id)).toEqual([nextKey]);
      expect(h.asked).toEqual([current]);
    },
  );

  it.each([
    ['still queued', 'queued' as const],
    ['not there', undefined],
  ])('keeps the bucket when its check is %s', async (_, status) => {
    const current = checkIdOfKey(`check:${SITE.id}:manual:${B}`);
    const h = withStatus(status === undefined ? {} : { [current]: status });
    const got = await requestCheck(h.deps, { siteId: SITE.id, trigger: 'manual' });
    expect(got.checkId).toBe(current);
    expect(h.sent.map((e) => e.id)).toEqual([`check:${SITE.id}:manual:${B}`]);
  });

  it('a repeat in the same bucket after its check started finds the next bucket’s check, once', async () => {
    const current = checkIdOfKey(`check:${SITE.id}:manual:${B}`);
    const h = withStatus({ [current]: 'running' });
    const a = await requestCheck(h.deps, { siteId: SITE.id, trigger: 'manual' });
    const b = await requestCheck(h.deps, { siteId: SITE.id, trigger: 'manual' });
    expect(b.checkId).toBe(a.checkId);
    expect([a.created, b.created]).toEqual([true, false]);
    expect(h.rows.size).toBe(1);
  });

  it.each(['scheduled', 'deploy', 'first_audit'] as const)(
    'does not read a status for %s',
    async (trigger) => {
      const h = withStatus({});
      await requestCheck(h.deps, { siteId: SITE.id, trigger });
      expect(h.asked).toEqual([]);
    },
  );

  it('a store with no status read keeps the bucket', async () => {
    const h = harness();
    const got = await requestCheck(h.deps, { siteId: SITE.id, trigger: 'manual' });
    expect(got.checkId).toBe(checkIdOfKey(`check:${SITE.id}:manual:${B}`));
  });
});
