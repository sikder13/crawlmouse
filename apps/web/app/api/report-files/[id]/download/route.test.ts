import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import { adminOver, sessionOver, type Person } from '@/lib/v2/account/sites-test-support';
import { reportPath, type ReportFormat } from '@/lib/v2/reports/generate';
import {
  memoryReportBucket,
  reportWorld,
  type ReportWorld,
} from '@/lib/v2/reports/generate-test-support';

// GET /api/report-files/[id]/download (CC-31 D7). The session and service-role clients are the
// PostgREST stand-in over PGlite with every migration applied, so row security decides which report
// a caller reads; the bucket signs in memory, and product events are recorded.

const h = vi.hoisted(() => ({
  log: [] as string[],
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  bucket: null as unknown as ReturnType<
    typeof import('@/lib/v2/reports/generate-test-support').memoryReportBucket
  >,
  events: [] as { event: string; distinctId: string; properties: unknown }[],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => {
    h.log.push('supabaseServer');
    return sessionOver(h.db, h.user);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    return adminOver(h.db);
  },
}));
vi.mock('@/lib/v2/reports/generate-run', async (original) => ({
  ...(await original<typeof import('@/lib/v2/reports/generate-run')>()),
  supabaseReportBucket: () => h.bucket.bucket,
}));
vi.mock('@/lib/analytics-server', () => ({
  captureServerEvent: async (_cookie: unknown, event: (typeof h.events)[number]) => {
    h.events.push(event);
  },
}));

import { GET } from './route';

let w: ReportWorld;
/** A stored PDF of the recorded site, a stored CSV of the account's other site, and the stranger's. */
let onSite: string;
let onOther: string;
let theirs: string;

/** A report row of `kind` and `format` in `state`, written as the functions leave one. */
async function report(
  accountId: string,
  siteId: string,
  checkId: string,
  format: ReportFormat,
  state: 'pending' | 'stored' | 'failed',
): Promise<string> {
  const id = randomUUID();
  await h.db.query(
    `insert into public.reports (id, account_id, site_id, kind, format, status, made_by,
                                 covers_check_ids, file_state, storage_path, byte_count, failed_reason)
     values ($1, $2, $3, $4, $5, 'ready', 'user', $6, $7, $8, $9, $10)`,
    [
      id,
      accountId,
      siteId,
      format === 'pdf' ? 'audit_pdf' : 'raw_export',
      format,
      [checkId],
      state,
      reportPath(accountId, id, format),
      state === 'stored' ? 1234 : null,
      state === 'failed' ? 'build_failed' : null,
    ],
  );
  return id;
}

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
  w = await reportWorld(h.db);
  onSite = await report(w.accountId, w.site.id, w.site.first, 'pdf', 'stored');
  onOther = await report(w.accountId, w.other.id, w.other.check, 'csv', 'stored');
  theirs = await report(w.stranger.accountId, w.stranger.site, w.stranger.check, 'pdf', 'stored');
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});

beforeEach(() => {
  h.log.length = 0;
  h.events.length = 0;
  h.user = null;
  h.bucket = memoryReportBucket();
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
});
afterEach(() => vi.unstubAllEnvs());

const as = (p: Person | null) => {
  h.user = p && { id: p.id, email: p.email };
};

const get = (id: string) =>
  GET(new Request(`https://crawlmouse.com/api/report-files/${id}/download`), {
    params: Promise.resolve({ id }),
  });

const answer = async (res: Response) => [res.status, await res.json()] as const;

/** No address was signed, no service-role client made and no event sent. */
function expectNothingSigned() {
  expect(h.bucket.signed).toEqual([]);
  expect(h.log).not.toContain('supabaseAdmin');
  expect(h.events).toEqual([]);
}

describe('GET /api/report-files/[id]/download', () => {
  it('with V2_CHECKS_PUBLIC unset: 404 before anything else runs', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    as(w.owner);
    expect(await answer(await get(onSite))).toEqual([404, { code: 'not_found' }]);
    expect(h.log).toEqual([]);
    expectNothingSigned();
  });

  it('signed out: 401, not kept by a cache', async () => {
    const res = await get(onSite);
    expect(await answer(res)).toEqual([401, { code: 'auth_required' }]);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expectNothingSigned();
  });

  it('the owner, an account manager and a developer whose seat covers the site: a 302 to the file’s address, signed for ten minutes', async () => {
    for (const who of [w.owner, w.manager, w.developer]) {
      as(who);
      h.bucket = memoryReportBucket();
      const res = await get(onSite);
      const path = reportPath(w.accountId, onSite, 'pdf');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`https://storage.test/reports/${path}?token=signed`);
      expect(h.bucket.signed).toEqual([[path, 600]]);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(await res.text()).toBe('');
    }
  });

  it('a report of a site the caller’s seat does not cover: 404', async () => {
    as(w.developer);
    expect(await answer(await get(onOther))).toEqual([404, { code: 'not_found' }]);
    as(w.outOfScope);
    expect(await answer(await get(onSite))).toEqual([404, { code: 'not_found' }]);
    expectNothingSigned();
    // Each downloads the report of the site their own seat covers.
    expect((await get(onOther)).status).toBe(302);
  });

  it('a report of another account: 404, both ways', async () => {
    as(w.owner);
    expect(await answer(await get(theirs))).toEqual([404, { code: 'not_found' }]);
    as(w.stranger);
    expect(await answer(await get(onSite))).toEqual([404, { code: 'not_found' }]);
    expectNothingSigned();
    expect((await get(theirs)).status).toBe(302);
  });

  it('a removed seat, an id that is no report and a malformed id: 404', async () => {
    as(w.removed);
    expect(await answer(await get(onSite))).toEqual([404, { code: 'not_found' }]);
    as(w.owner);
    for (const id of [randomUUID(), 'nope', `${onSite}x`, '../../etc']) {
      expect(await answer(await get(id)), id).toEqual([404, { code: 'not_found' }]);
    }
    expectNothingSigned();
  });

  it('a report whose file is not stored: 409 not_ready', async () => {
    as(w.owner);
    const pending = await report(w.accountId, w.site.id, w.site.first, 'pdf', 'pending');
    const failed = await report(w.accountId, w.site.id, w.site.first, 'pdf', 'failed');
    const publicLink = (
      await h.db.query<{ id: string }>(
        `insert into public.reports (account_id, site_id, kind, format, status, made_by,
                                     covers_check_ids, public_slug)
         values ($1, $2, 'public_link', 'html', 'ready', 'user', $3, $4) returning id`,
        [w.accountId, w.site.id, [w.site.first], `link-${randomUUID()}`],
      )
    ).rows[0]!.id;
    for (const id of [pending, failed, publicLink]) {
      const res = await get(id);
      expect(await answer(res), id).toEqual([409, { code: 'not_ready' }]);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expectNothingSigned();
  });

  it('sends report_downloaded with the report’s kind and format, and nothing else', async () => {
    as(w.developer);
    await get(onSite);
    expect(h.events).toEqual([
      {
        event: 'report_downloaded',
        distinctId: `account:${w.accountId}`,
        properties: { kind: 'audit_pdf', format: 'pdf' },
      },
    ]);
  });
});
