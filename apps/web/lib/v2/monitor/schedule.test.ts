import { describe, expect, it, vi } from 'vitest';
import type { QueuedCheck, RequestSite } from '../pipeline/store';
import { checkIdOfKey } from '../pipeline/ids';
import { scheduleDeps, type SchedulePorts } from './schedule';

vi.mock('server-only', () => ({}));

const SITE = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
// 2026-11-13T10:00:00Z; the global:audits:day window it falls in starts at midnight UTC that day.
const NOW = Date.UTC(2026, 10, 13, 10, 0, 0);
const WINDOW = '2026-11-13T00:00:00.000Z';
const SLOT = '2026-11-09T06:00:00.000Z';

function ports(over: Partial<SchedulePorts> = {}) {
  const rpc = vi.fn<SchedulePorts['rpc']>(over.rpc ?? (async () => []));
  const rows = new Map<string, QueuedCheck>();
  const sent: Parameters<SchedulePorts['send']>[0][] = [];
  const capture = vi.fn<SchedulePorts['capture']>();
  const p: SchedulePorts = {
    pipeline: {
      // As the database reads after the claim: next_check_at has already moved a week on.
      requestSite: async (id): Promise<RequestSite> => ({
        id,
        account_id: ACCOUNT,
        host: 'shop.example.com',
        next_check_at: '2026-11-16T06:00:00+00:00',
      }),
      insertQueued: async (row) => {
        if (rows.has(row.id)) return false;
        rows.set(row.id, row);
        return true;
      },
    },
    send: async (e) => {
      sent.push(e);
    },
    now: () => NOW,
    newId: () => {
      throw new Error('a scheduled request of a kept site is bucketed');
    },
    capture,
    env: {},
    ...over,
    rpc,
  };
  return { p, rpc, rows, sent, capture };
}

describe('scheduleDeps.paused: CRAWL_PAUSED', () => {
  it.each([
    [{ CRAWL_PAUSED: '1' }, true],
    [{ CRAWL_PAUSED: ' 1\n' }, true],
    [{ CRAWL_PAUSED: '0' }, false],
    [{ CRAWL_PAUSED: 'true' }, false],
    [{}, false],
  ])('%j → %s', (env, paused) => {
    expect(scheduleDeps(ports({ env }).p).paused()).toBe(paused);
  });
});

describe('scheduleDeps.claim: claim_due_sites with the global slot add_site takes', () => {
  it('passes the time, the limit and the global:audits:day slot of now, and reads back each site and its due time', async () => {
    const h = ports({
      rpc: async () => [{ site_id: SITE, account_id: ACCOUNT, slot: '2026-11-09T06:00:00+00:00' }],
    });
    const got = await scheduleDeps(h.p).claim(40);
    expect(h.rpc.mock.calls).toEqual([
      [
        'claim_due_sites',
        {
          p_now: '2026-11-13T10:00:00.000Z',
          p_limit: 40,
          p_global: { bucket: 'global:audits:day', window_start: WINDOW, limit: 5000 },
        },
      ],
    ]);
    expect(got).toEqual({
      global: { bucket: 'global:audits:day', window_start: WINDOW },
      sites: [{ siteId: SITE, slot: SLOT }],
    });
  });

  it('refuses an answer that is not rows of a site and a time', async () => {
    const h = ports({ rpc: async () => [{ site_id: 'nope', slot: 'later' }] });
    await expect(scheduleDeps(h.p).claim(40)).rejects.toThrow();
  });
});

describe('scheduleDeps.request: requestCheck keyed on the claimed slot', () => {
  it('requests a scheduled check whose key and id are the slot’s, not the site’s moved due time', async () => {
    const h = ports();
    const key = `check:${SITE}:scheduled:${SLOT}`;
    expect(await scheduleDeps(h.p).request({ siteId: SITE, slot: SLOT })).toEqual({
      checkId: checkIdOfKey(key),
      created: true,
    });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.id).toBe(key);
    expect(h.sent[0]!.data).toMatchObject({ siteId: SITE, trigger: 'scheduled' });
    expect([...h.rows.values()][0]).toMatchObject({ id: checkIdOfKey(key), trigger: 'scheduled' });
  });

  it('a retried request step makes the same check and sends the same event id', async () => {
    const h = ports();
    const d = scheduleDeps(h.p);
    const a = await d.request({ siteId: SITE, slot: SLOT });
    const b = await d.request({ siteId: SITE, slot: SLOT });
    expect(b.checkId).toBe(a.checkId);
    expect(b.created).toBe(false);
    expect(h.rows.size).toBe(1);
    expect(h.sent.map((e) => e.id)).toEqual([
      `check:${SITE}:scheduled:${SLOT}`,
      `check:${SITE}:scheduled:${SLOT}`,
    ]);
  });
});

describe('scheduleDeps.release: release_scheduled_claim (owner ruling Q9)', () => {
  it('passes the site, the slot, the row the claim counted into, and the time now', async () => {
    const h = ports({ rpc: async () => ({ restored: true, slot_released: true }) });
    const got = await scheduleDeps(h.p).release(
      { siteId: SITE, slot: SLOT },
      { bucket: 'global:audits:day', window_start: '2026-11-12T00:00:00.000Z' },
    );
    expect(got).toEqual({ restored: true, slot_released: true });
    expect(h.rpc.mock.calls).toEqual([
      [
        'release_scheduled_claim',
        {
          p_site: SITE,
          p_slot: SLOT,
          // The claim's window, not the one now falls in.
          p_global: { bucket: 'global:audits:day', window_start: '2026-11-12T00:00:00.000Z' },
          p_now: '2026-11-13T10:00:00.000Z',
        },
      ],
    ]);
  });
});

describe('scheduleDeps.report', () => {
  it('tells Sentry the site id and the slot, and nothing else', () => {
    const h = ports();
    scheduleDeps(h.p).report({ siteId: SITE, slot: SLOT });
    expect(h.capture.mock.calls).toEqual([
      ['schedule.claim_released', { siteId: SITE, slot: SLOT }],
    ]);
  });
});
