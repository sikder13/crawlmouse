/**
 * How `readClientReports` asks for its rows, against clients that record each request: the list of
 * sent reports is read to its end whatever the server's row cap, and the site ids travel a hundred
 * to a request. What row security returns to which seat is `app/agency/reports/page.test.tsx`'s,
 * on the migrated schema.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { fixture } from '../fixtures';
import type { AccountDataset } from '../view/account';

vi.mock('server-only', () => ({}));

import { readClientReports } from './client-reports-read';

type Call = [method: string, ...args: unknown[]];
type Answer = { data: unknown[]; error: { message: string } | null };

/** A client whose every request is answered by `answer`, given the calls that built it. */
function recording(answer: (calls: Call[]) => Answer) {
  const requests: Call[][] = [];
  const client = {
    from(table: string) {
      const calls: Call[] = [['from', table]];
      const chain: Record<string, unknown> = {
        then: (resolve: (a: Answer) => unknown) => {
          requests.push(calls);
          return Promise.resolve(answer(calls)).then(resolve);
        },
      };
      for (const method of ['select', 'in', 'eq', 'order', 'range']) {
        chain[method] = (...args: unknown[]) => {
          calls.push([method, ...args]);
          return chain;
        };
      }
      return chain;
    },
    // `report_ask_refusals`: no contact of these records has refused.
    rpc: async (fn: string, args: unknown) => {
      requests.push([['rpc', fn, args]]);
      return { data: {}, error: null };
    },
  };
  return { client: client as unknown as SupabaseClient, requests };
}

const SENT = fixture('challenged-site').reports.find(
  (r) => r.kind === 'client_report' && r.status === 'sent',
)!;
const report = (n: number) => ({
  ...SENT,
  id: `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
});
const records = (siteIds: string[]): AccountDataset =>
  ({ sites: siteIds.map((id) => ({ id })), reports: [] }) as unknown as AccountDataset;
const arg = (calls: Call[], method: string) => calls.find(([m]) => m === method)?.slice(1);
const nothing = () => recording(() => ({ data: [], error: null }));

describe('readClientReports', () => {
  it('reads the sent reports page after page until one is empty, under a row cap below its page', async () => {
    // The server answers two rows a request, whatever range was asked for.
    const all = [report(1), report(2), report(3), report(4), report(5)];
    const session = recording((calls) => {
      const [from] = arg(calls, 'range') as [number, number];
      return { data: all.filter((_r, i) => i >= from && i < from + 2), error: null };
    });
    const read = await readClientReports(
      { session: session.client, admin: nothing().client },
      records([SENT.site_id]),
    );
    expect(read.d.reports.map((r) => r.id)).toEqual(all.map((r) => r.id));
    expect(session.requests.map((calls) => (arg(calls, 'range') as number[])[0])).toEqual([
      0, 2, 4, 5,
    ]);
  });

  it('asks the session for client reports that were sent, of the records’ sites', async () => {
    const session = nothing();
    await readClientReports(
      { session: session.client, admin: nothing().client },
      records([SENT.site_id]),
    );
    expect(session.requests).toHaveLength(1);
    const calls = session.requests[0]!;
    expect(calls[0]).toEqual(['from', 'reports']);
    expect(calls).toContainEqual(['in', 'site_id', [SENT.site_id]]);
    expect(calls).toContainEqual(['eq', 'kind', 'client_report']);
    expect(calls).toContainEqual(['eq', 'status', 'sent']);
  });

  it('sends the site ids a hundred to a request, to the session and to the service role', async () => {
    const ids = Array.from({ length: 250 }, (_x, n) => `site-${n}`);
    const session = nothing();
    const admin = nothing();
    await readClientReports({ session: session.client, admin: admin.client }, records(ids));
    const lists = (requests: Call[][]) =>
      requests
        .filter((calls) => calls[0]![0] === 'from')
        .map((calls) => (arg(calls, 'in') as [string, string[]])[1]);
    for (const asked of [lists(session.requests), lists(admin.requests)]) {
      expect(asked.map((l) => l.length)).toEqual([100, 100, 50]);
      expect(asked.flat()).toEqual(ids);
    }
  });

  it('asks the service role which contacts may not be asked, for the records’ sites and at the moment given', async () => {
    const now = new Date('2026-11-12T12:00:00.000Z');
    const refused = 'a0000000-0000-4000-8000-000000000001';
    const admin = recording(() => ({ data: [], error: null }));
    (admin.client as unknown as { rpc: unknown }).rpc = async (fn: string, args: unknown) => {
      admin.requests.push([['rpc', fn, args]]);
      return {
        data: { [refused]: { refused: 'asked_recently', next_at: '2026-12-01T10:00:00+00:00' } },
        error: null,
      };
    };
    const read = await readClientReports(
      { session: nothing().client, admin: admin.client, now: () => now },
      records([refused, 'site-2']),
    );
    expect(admin.requests.filter((calls) => calls[0]![0] === 'rpc')).toEqual([
      [['rpc', 'report_ask_refusals', { p_sites: [refused, 'site-2'], p_now: now.toISOString() }]],
    ]);
    expect([...read.side.refusals!]).toEqual([
      [refused, { refused: 'asked_recently', nextAt: '2026-12-01T10:00:00.000Z' }],
    ]);
  });

  it('asks the service role for the file states of the reports the session returned', async () => {
    const session = recording((calls) =>
      (arg(calls, 'range') as number[])[0] === 0
        ? { data: [report(7)], error: null }
        : { data: [], error: null },
    );
    const admin = recording((calls) =>
      calls[0]![1] === 'reports'
        ? {
            data: [{ id: report(7).id, storage_path: 'a/b.html', file_state: 'stored' }],
            error: null,
          }
        : {
            data: [
              {
                site_id: SENT.site_id,
                next_run_at: '2026-11-02 15:00:00+00',
                recipient_confirm_sent_at: '2026-10-24T15:00:00+00:00',
                recipient_confirmed_at: null,
              },
            ],
            error: null,
          },
    );
    const read = await readClientReports(
      { session: session.client, admin: admin.client },
      records([SENT.site_id]),
    );
    expect(read.side.fileStates).toEqual(new Map([[report(7).id, 'stored']]));
    // Timestamps reach the view as the contract's UTC instants.
    expect(read.side.schedules).toEqual(
      new Map([
        [
          SENT.site_id,
          {
            nextRunAt: '2026-11-02T15:00:00Z',
            confirmSentAt: '2026-10-24T15:00:00Z',
            confirmedAt: null,
          },
        ],
      ]),
    );
    const files = admin.requests.find((calls) => calls[0]![1] === 'reports')!;
    expect(files).toContainEqual(['in', 'id', [report(7).id]]);
  });

  it('throws when a read fails, naming the table', async () => {
    const failing = recording(() => ({ data: [], error: { message: 'boom' } }));
    await expect(
      readClientReports({ session: failing.client, admin: nothing().client }, records(['s'])),
    ).rejects.toThrow('reports read failed: boom');
    await expect(
      readClientReports({ session: nothing().client, admin: failing.client }, records(['s'])),
    ).rejects.toThrow('report_schedules read failed: boom');
  });
});
