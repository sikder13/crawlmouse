import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { PDFDocument } from 'pdf-lib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import { insertRow, ROWS } from '@/__tests__/helpers/v2-check-tables';
import { rateLimitWindowStart } from '@/lib/rate-limit-window';
import { NOTICE_LINES, noticeLine } from '@/lib/v2/copy/notices';
import {
  adminOver,
  keptSite,
  makePaid,
  person,
  sessionOver,
  type Person,
} from '@/lib/v2/account/sites-test-support';
import { reportPath, type ReportDoc, type ReportFile } from '@/lib/v2/reports/generate';
import {
  memoryReportBucket,
  reportWorld,
  type ReportWorld,
} from '@/lib/v2/reports/generate-test-support';

// POST /api/reports (CC-31 D6). The session and service-role clients are the PostgREST stand-in over
// PGlite with every migration applied, so membership, the Guard column, row security, the rate
// limit and create_report / finish_report run for real. A check's records are read back as the
// pipeline's tests read them, the bucket is a map in memory, and product events are recorded.

const h = vi.hoisted(() => ({
  log: [] as string[],
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  bucket: null as unknown as ReturnType<
    typeof import('@/lib/v2/reports/generate-test-support').memoryReportBucket
  >,
  events: [] as { event: string; distinctId: string; properties: unknown }[],
  /** A rate-limit bucket's prefix whose limiter call fails, or null. */
  limiterDownFor: null as string | null,
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
    const admin = adminOver(h.db);
    if (h.limiterDownFor === null) return admin;
    // The rate limiter's own call fails for the bucket named: what the bound does then is the
    // route's `failClosed`.
    const down = h.limiterDownFor;
    return new Proxy(admin, {
      get(target, key, receiver) {
        if (key !== 'rpc') return Reflect.get(target, key, receiver) as unknown;
        return (fn: string, args: { p_bucket_key?: string }) =>
          fn === 'increment_rate_limit' && args.p_bucket_key?.startsWith(down)
            ? Promise.resolve({ data: null, error: { message: 'the limiter is down' } })
            : target.rpc(fn, args);
      },
    });
  },
}));
vi.mock('@/lib/v2/pipeline/load', async (original) => {
  const { pgliteCheckReader } = await import('@/lib/v2/pipeline/test-support/pglite');
  return {
    ...(await original<typeof import('@/lib/v2/pipeline/load')>()),
    supabaseCheckReader: () => pgliteCheckReader(h.db),
  };
});
vi.mock('@/lib/v2/reports/generate-run', async (original) => ({
  ...(await original<typeof import('@/lib/v2/reports/generate-run')>()),
  supabaseReportBucket: () => h.bucket.bucket,
}));
vi.mock('@/lib/analytics-server', () => ({
  captureServerEvent: async (_cookie: unknown, event: (typeof h.events)[number]) => {
    h.events.push(event);
  },
}));

import { POST } from './route';

let w: ReportWorld;

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
  w = await reportWorld(h.db);
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});

beforeEach(async () => {
  h.log.length = 0;
  h.events.length = 0;
  h.user = null;
  h.limiterDownFor = null;
  h.bucket = memoryReportBucket();
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  await h.db.query(`delete from public.rate_limits where bucket_key like 'reports:account%'`);
});
afterEach(() => vi.unstubAllEnvs());

const as = (p: Person | null) => {
  h.user = p && { id: p.id, email: p.email };
};

function post(body: unknown, form = false) {
  return POST(
    new Request('https://crawlmouse.com/api/reports', {
      method: 'POST',
      headers: {
        origin: 'https://crawlmouse.com',
        'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
      },
      body: form
        ? new URLSearchParams(body as Record<string, string>).toString()
        : typeof body === 'string'
          ? body
          : JSON.stringify(body),
    }),
  );
}

const audit = (over: Record<string, unknown> = {}) => ({
  kind: 'audit_pdf',
  siteId: w.site.id,
  checkId: w.site.first,
  ...over,
});

interface Row {
  id: string;
  account_id: string;
  site_id: string;
  kind: string;
  format: string;
  status: string;
  made_by: string;
  file_state: string | null;
  storage_path: string | null;
  failed_reason: string | null;
  subject_fix_id: string | null;
  covers_check_ids: string[];
}

const reports = async (where = `made_by = 'user' and file_state is not null`) =>
  (
    await h.db.query<Row>(
      `select id, account_id, site_id, kind, format, status, made_by, file_state, storage_path,
              failed_reason, subject_fix_id, covers_check_ids
         from public.reports where ${where} order by created_at, id`,
    )
  ).rows;
const reportById = async (id: string) => (await reports(`id = '${id}'`))[0]!;
const countReports = async () => (await reports('true')).length;

const answer = async (res: Response) => [res.status, await res.json()] as const;

const docIn = (file: ReportFile) => JSON.parse(new TextDecoder().decode(file.bytes)) as ReportDoc;

/** Nothing was written and no service-role client was made. */
async function expectNothingDone(before: number) {
  expect(await countReports()).toBe(before);
  expect(h.log).not.toContain('supabaseAdmin');
  expect(h.bucket.objects.size).toBe(0);
  expect(h.events).toEqual([]);
}

describe('POST /api/reports: who is answered', () => {
  it('with V2_CHECKS_PUBLIC unset: 404 before anything else runs', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    as(w.owner);
    const before = await countReports();
    expect(await answer(await post(audit()))).toEqual([404, { code: 'not_found' }]);
    expect(h.log).toEqual([]);
    await expectNothingDone(before);
  });

  it('signed out: 401', async () => {
    const before = await countReports();
    expect(await answer(await post(audit()))).toEqual([401, { code: 'auth_required' }]);
    await expectNothingDone(before);
  });

  it('a body that is not one of the requests: 400 invalid', async () => {
    as(w.owner);
    const before = await countReports();
    const bodies: unknown[] = [
      '{not json',
      [],
      {},
      audit({ kind: 'public_link' }),
      audit({ kind: 'client_report' }),
      audit({ extra: 1 }),
      audit({ siteId: 'nope' }),
      audit({ format: 'csv' }),
      { kind: 'raw_export', siteId: w.site.id, checkId: w.site.first, format: 'pdf' },
      { kind: 'raw_export', siteId: w.site.id, checkId: w.site.first },
      {
        kind: 'compare',
        siteId: w.site.id,
        checkId: w.site.second,
        previousCheckId: w.site.first,
        fixId: w.site.verifiedFix,
      },
      { kind: 'compare', siteId: w.site.id, checkId: w.site.first, previousCheckId: w.site.first },
    ];
    for (const body of bodies) {
      expect(await answer(await post(body)), JSON.stringify(body)).toEqual([
        400,
        { code: 'invalid' },
      ]);
    }
    await expectNothingDone(before);
  });

  it('a prospect’s one-pager is not a request this route takes: 400 invalid, with nothing read', async () => {
    as(w.owner);
    const before = await countReports();
    expect(await answer(await post({ kind: 'prospect_one_pager', url: 'example.com' }))).toEqual([
      400,
      { code: 'invalid' },
    ]);
    expect(h.log).toEqual(['supabaseServer']);
    await expectNothingDone(before);
  });

  it('the owner, an account manager and a developer whose seat covers the site: 201, a stored PDF', async () => {
    for (const who of [w.owner, w.manager, w.developer]) {
      as(who);
      h.bucket = memoryReportBucket();
      const res = await post(audit());
      expect(res.status).toBe(201);
      const { reportId } = (await res.json()) as { reportId: string };
      const path = reportPath(w.accountId, reportId, 'pdf');
      expect(await reportById(reportId)).toEqual({
        id: reportId,
        account_id: w.accountId,
        site_id: w.site.id,
        kind: 'audit_pdf',
        format: 'pdf',
        status: 'ready',
        made_by: 'user',
        file_state: 'stored',
        storage_path: path,
        failed_reason: null,
        subject_fix_id: null,
        covers_check_ids: [w.site.first],
      });
      expect([...h.bucket.objects.keys()]).toEqual([path]);
      const pdf = await PDFDocument.load(h.bucket.objects.get(path)!.bytes);
      expect(pdf.getTitle()).toBe('Audit report');
    }
  });

  it('a developer whose seat does not cover the site: 404, never 403', async () => {
    as(w.outOfScope);
    const before = await countReports();
    expect(await answer(await post(audit()))).toEqual([404, { code: 'not_found' }]);
    await expectNothingDone(before);
    // The same seat makes a report of the site it does cover: a row is written for it.
    const res = await post(audit({ siteId: w.other.id, checkId: w.other.check }));
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(403);
    expect(await countReports()).toBe(before + 1);
  });

  it('a removed seat and a stranger: 404', async () => {
    const before = await countReports();
    for (const who of [w.removed, w.stranger]) {
      as(who);
      expect(await answer(await post(audit()))).toEqual([404, { code: 'not_found' }]);
    }
    await expectNothingDone(before);
  });

  it('a Free account: 402 with the gate’s name; the same account on Pro: 201', async () => {
    const own = {
      kind: 'raw_export',
      format: 'csv',
      siteId: w.stranger.site,
      checkId: w.stranger.check,
    };
    as(w.stranger);
    const before = await countReports();
    expect(await answer(await post(own))).toEqual([
      402,
      { code: 'upgrade_required', gate: 'exports' },
    ]);
    expect(await answer(await post({ ...own, kind: 'audit_pdf', format: undefined }))).toEqual([
      402,
      { code: 'upgrade_required', gate: 'exports' },
    ]);
    await expectNothingDone(before);

    // An account on Pro, with a site and a check of its own, is not sent to the gate.
    const pro = await person(h.db, 'pro');
    await makePaid(h.db, pro.accountId, 'pro');
    const site = await keptSite(h.db, pro.accountId);
    const check = randomUUID();
    await insertRow(h.db, 'checks', ROWS.checks(check, site.id));
    as(pro);
    const res = await post({ ...own, siteId: site.id, checkId: check });
    expect(res.status).not.toBe(402);
    expect(await countReports()).toBe(before + 1);
  });
});

describe('POST /api/reports: what a report may cover', () => {
  it('a check of another site, of another account, with no result or that does not exist: 404', async () => {
    as(w.owner);
    const queued = (
      await h.db.query<{ id: string }>(
        `insert into public.checks (site_id, status, trigger, grade_version)
         values ($1, 'queued', 'manual', '2.0.0') returning id`,
        [w.other.id],
      )
    ).rows[0]!.id;
    const before = await countReports();
    const bodies = [
      audit({ checkId: w.other.check }),
      audit({ checkId: w.stranger.check }),
      audit({ siteId: w.stranger.site, checkId: w.stranger.check }),
      audit({ siteId: w.stranger.site }),
      audit({ checkId: randomUUID() }),
      audit({ siteId: randomUUID() }),
      audit({ siteId: w.other.id, checkId: queued }),
      {
        kind: 'compare',
        siteId: w.site.id,
        checkId: w.site.second,
        previousCheckId: w.other.check,
      },
      { kind: 'compare', siteId: w.site.id, checkId: w.other.check, previousCheckId: w.site.first },
    ];
    for (const body of bodies) {
      expect(await answer(await post(body)), JSON.stringify(body)).toEqual([
        404,
        { code: 'not_found' },
      ]);
    }
    await expectNothingDone(before);
  });

  it('a removed site: 404, for a check of its own too', async () => {
    as(w.owner);
    const gone = await keptSite(h.db, w.accountId, { removed_at: '2026-11-01T00:00:00Z' });
    const check = randomUUID();
    await insertRow(h.db, 'checks', ROWS.checks(check, gone.id));
    const before = await countReports();
    expect(await answer(await post(audit({ siteId: gone.id, checkId: check })))).toEqual([
      404,
      { code: 'not_found' },
    ]);
    await expectNothingDone(before);
  });

  it('each raw export: the check’s rows in the format asked for', async () => {
    as(w.developer);
    for (const [format, contentType] of [
      ['csv', 'text/csv; charset=utf-8'],
      ['edge_list', 'text/csv; charset=utf-8'],
      ['json', 'application/json'],
    ] as const) {
      const res = await post({
        kind: 'raw_export',
        format,
        siteId: w.site.id,
        checkId: w.site.first,
      });
      expect(res.status).toBe(201);
      const { reportId } = (await res.json()) as { reportId: string };
      const file = h.bucket.objects.get(reportPath(w.accountId, reportId, format))!;
      expect(file.contentType).toBe(contentType);
      expect(await reportById(reportId)).toMatchObject({
        kind: 'raw_export',
        format,
        file_state: 'stored',
      });
    }
    const csv = [...h.bucket.objects.entries()].find(([path]) => /[0-9a-f]\.csv$/.test(path))![1];
    expect(new TextDecoder().decode(csv.bytes).split('\r\n')).toHaveLength(
      w.builds.first.page_results.length + 2,
    );
  });

  it('a compare: the two checks earlier first, a baseline for one, and a fix the later check verified', async () => {
    as(w.manager);
    const compare = (over: Record<string, unknown>) =>
      post({ kind: 'compare', siteId: w.site.id, checkId: w.site.second, ...over });
    const made = async (res: Response) => {
      expect(res.status).toBe(201);
      const { reportId } = (await res.json()) as { reportId: string };
      const row = await reportById(reportId);
      expect(row).toMatchObject({ kind: 'compare', format: 'html', file_state: 'stored' });
      return { row, doc: docIn(h.bucket.objects.get(reportPath(w.accountId, reportId, 'html'))!) };
    };

    const two = await made(await compare({ previousCheckId: w.site.first }));
    expect(two.row.covers_check_ids).toEqual([w.site.first, w.site.second]);
    expect(two.doc.title).toBe('Before and after');

    // Named the other way round, the row still holds the earlier check first.
    const swapped = await made(
      await post({
        kind: 'compare',
        siteId: w.site.id,
        checkId: w.site.first,
        previousCheckId: w.site.second,
      }),
    );
    expect(swapped.row.covers_check_ids).toEqual([w.site.first, w.site.second]);

    const baseline = await made(await compare({}));
    expect(baseline.row.covers_check_ids).toEqual([w.site.second]);
    expect(baseline.doc.title).toBe('Baseline');

    const proof = await made(await compare({ fixId: w.site.verifiedFix }));
    expect(proof.row.covers_check_ids).toEqual([w.site.first, w.site.second]);
    expect(proof.row.subject_fix_id).toBe(w.site.verifiedFix);
    expect(proof.doc.title).toBe('Fix verified');
  });

  it('a fix that is not the site’s: 404; a fix at a check with none before it: 400', async () => {
    as(w.owner);
    const elsewhere = randomUUID();
    await insertRow(
      h.db,
      'site_fixes',
      ROWS.site_fixes(elsewhere, w.other.id, w.other.check, 9001),
    );
    const before = await countReports();
    const compare = (over: Record<string, unknown>) =>
      post({ kind: 'compare', siteId: w.site.id, checkId: w.site.second, ...over });
    expect(await answer(await compare({ fixId: randomUUID() }))).toEqual([
      404,
      { code: 'not_found' },
    ]);
    expect(
      await answer(await compare({ checkId: w.site.first, fixId: w.site.verifiedFix })),
    ).toEqual([400, { code: 'invalid' }]);
    await expectNothingDone(before);
    // A fix of the account's other site: the caller's seat covers it, and create_report refuses it.
    expect(await answer(await compare({ fixId: elsewhere }))).toEqual([404, { code: 'not_found' }]);
    expect(await countReports()).toBe(before);
    expect(h.bucket.objects.size).toBe(0);
  });
});

describe('POST /api/reports: a refused form goes back to Reports with a line; JSON keeps its answer', () => {
  /** Where a form was sent, as the page reads it back: the path, the notice and the next time. */
  const sentTo = (res: Response) => {
    const to = new URL(res.headers.get('location')!, 'https://crawlmouse.com');
    return [res.status, to.pathname, to.searchParams.get('notice')] as const;
  };
  const lineOf = (res: Response) => {
    const to = new URL(res.headers.get('location')!, 'https://crawlmouse.com');
    return noticeLine(Object.fromEntries(to.searchParams), 'UTC')!.text;
  };

  it('400, a request that is not one of the kinds: the notice for a request not understood', async () => {
    as(w.owner);
    const before = await countReports();
    const bad = { kind: 'client_report', siteId: w.site.id, checkId: w.site.first };
    const form = await post(bad, true);
    expect(sentTo(form)).toEqual([303, '/reports', 'invalid']);
    expect(lineOf(form)).toBe(NOTICE_LINES.invalid(null));
    expect(await answer(await post(bad))).toEqual([400, { code: 'invalid' }]);
    await expectNothingDone(before);
  });

  it('400, a comparison with no earlier check to compare with: the same notice', async () => {
    as(w.owner);
    const before = await countReports();
    for (const bad of [
      // The earlier check named is the later one.
      {
        kind: 'compare',
        siteId: w.site.id,
        checkId: w.site.second,
        previousCheckId: w.site.second,
      },
      // A fix at the site's first check, which was compared with none.
      { kind: 'compare', siteId: w.site.id, checkId: w.site.first, fixId: w.site.verifiedFix },
    ]) {
      const form = await post(bad, true);
      expect(sentTo(form)).toEqual([303, '/reports', 'invalid']);
      expect(lineOf(form)).toBe(NOTICE_LINES.invalid(null));
      expect(await answer(await post(bad))).toEqual([400, { code: 'invalid' }]);
    }
    await expectNothingDone(before);
  });

  it('402, a plan with no exports: the notice that a paid plan is needed', async () => {
    as(w.stranger);
    const before = await countReports();
    const own = { kind: 'audit_pdf', siteId: w.stranger.site, checkId: w.stranger.check };
    const form = await post(own, true);
    expect(sentTo(form)).toEqual([303, '/reports', 'upgrade_required']);
    expect(lineOf(form)).toBe('That needs a paid plan.');
    expect((await post(own)).status).toBe(402);
    await expectNothingDone(before);
  });

  it('409, the proof of a fix the check did not verify: its own notice', async () => {
    as(w.owner);
    const before = await countReports();
    const unverified = {
      kind: 'compare',
      siteId: w.site.id,
      checkId: w.site.second,
      fixId: w.site.openFix,
    };
    const form = await post(unverified, true);
    expect(sentTo(form)).toEqual([303, '/reports', 'fix_not_verified']);
    expect(lineOf(form)).toBe(
      'That check did not verify the fix, so there is no proof to make. Nothing was made.',
    );
    expect(await answer(await post(unverified))).toEqual([409, { code: 'fix_not_verified' }]);
    expect(await countReports()).toBe(before);
    expect(h.bucket.objects.size).toBe(0);
  });

  it.each([
    ['hourly', 'reports:account:', 60 * 60 * 1000, 30],
    ['daily', 'reports:account-day:', 24 * 60 * 60 * 1000, 100],
  ] as const)(
    '429, past the account’s %s bound: the notice says reports, and when the next can be made',
    async (_name, prefix, windowMs, bound) => {
      as(w.owner);
      const windowStart = rateLimitWindowStart(Date.now(), windowMs);
      await h.db.query(
        `insert into public.rate_limits (bucket_key, window_start, request_count) values ($1, $2, $3)`,
        [`${prefix}${w.accountId}`, windowStart.toISOString(), bound],
      );
      const before = await countReports();
      const form = await post(
        { kind: 'audit_pdf', siteId: w.site.id, checkId: w.site.first },
        true,
      );
      expect(sentTo(form)).toEqual([303, '/reports', 'reports_capped']);
      // The next is allowed when the window that is full ends.
      const next = new URL(
        form.headers.get('location')!,
        'https://crawlmouse.com',
      ).searchParams.get('next');
      expect(next).toBe(new Date(windowStart.getTime() + windowMs).toISOString());
      expect(lineOf(form)).toMatch(
        /^This account has made as many reports as it may for now, so none was made\. The next can be made \w{3} \d{2}:\d{2}\.$/,
      );
      expect(lineOf(form)).not.toContain('email');
      const json = await post(audit());
      expect(await answer(json)).toEqual([429, { code: 'rate_limited' }]);
      expect(Number(json.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(await countReports()).toBe(before);
      expect(h.bucket.objects.size).toBe(0);
    },
  );

  it('401 and 404 are not answered with a page: a form gets the JSON refusal too', async () => {
    const own = { kind: 'audit_pdf', siteId: w.site.id, checkId: w.site.first };
    as(null);
    expect(await answer(await post(own, true))).toEqual([401, { code: 'auth_required' }]);
    as(w.stranger);
    expect(await answer(await post(own, true))).toEqual([404, { code: 'not_found' }]);
  });
});

describe('POST /api/reports: the answer', () => {
  it('a form is sent back to /reports', async () => {
    as(w.owner);
    const before = await countReports();
    const res = await post({ kind: 'audit_pdf', siteId: w.site.id, checkId: w.site.first }, true);
    expect([res.status, res.headers.get('location')]).toEqual([303, '/reports']);
    expect(await countReports()).toBe(before + 1);
    expect(h.bucket.objects.size).toBe(1);
  });

  it('sends report_generated once, with the kind and format and nothing else, for a stored file', async () => {
    as(w.owner);
    await post({ kind: 'raw_export', format: 'json', siteId: w.site.id, checkId: w.site.first });
    expect(h.events).toEqual([
      {
        event: 'report_generated',
        distinctId: `account:${w.accountId}`,
        properties: { kind: 'raw_export', format: 'json' },
      },
    ]);
  });

  it('when the file cannot be made: the row is failed, JSON gets 500 with its id, a form its 303, and no event is sent', async () => {
    as(w.owner);
    h.bucket.state.refuse = true;
    const res = await post(audit());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; reportId: string };
    expect(body.code).toBe('report_failed');
    expect(await reportById(body.reportId)).toMatchObject({
      file_state: 'failed',
      failed_reason: 'store_failed',
      storage_path: reportPath(w.accountId, body.reportId, 'pdf'),
    });
    const form = await post({ kind: 'audit_pdf', siteId: w.site.id, checkId: w.site.first }, true);
    expect([form.status, form.headers.get('location')]).toEqual([303, '/reports']);
    expect(h.events).toEqual([]);
  });

  it('the proof of a fix the later check did not verify is refused before a row or a file is written: 409', async () => {
    as(w.owner);
    const before = await countReports();
    const unverified = await post({
      kind: 'compare',
      siteId: w.site.id,
      checkId: w.site.second,
      fixId: w.site.openFix,
    });
    expect(await answer(unverified)).toEqual([409, { code: 'fix_not_verified' }]);
    expect(await countReports()).toBe(before);
    expect(h.bucket.objects.size).toBe(0);
    // The fix it did verify is made.
    const verified = await post({
      kind: 'compare',
      siteId: w.site.id,
      checkId: w.site.second,
      fixId: w.site.verifiedFix,
    });
    expect(verified.status).toBe(201);
  });

  it.each([
    ['hourly', 'reports:account:'],
    ['daily', 'reports:account-day:'],
  ] as const)(
    'the %s bound fails closed: with its limiter down no report is made',
    async (_name, prefix) => {
      as(w.owner);
      h.limiterDownFor = prefix;
      const before = await countReports();
      const res = await post(audit());
      expect(await answer(res)).toEqual([429, { code: 'rate_limited' }]);
      expect(await countReports()).toBe(before);
      expect(h.bucket.objects.size).toBe(0);
    },
  );

  it.each([
    ['hourly', 'reports:account:', 60 * 60 * 1000, 30],
    ['daily', 'reports:account-day:', 24 * 60 * 60 * 1000, 100],
  ] as const)(
    'past the account’s %s bound: 429 with Retry-After, and nothing written',
    async (_name, prefix, windowMs, bound) => {
      as(w.owner);
      const fill = (count: number) =>
        h.db.query(
          `insert into public.rate_limits (bucket_key, window_start, request_count)
           values ($1, $2, $3)
           on conflict (bucket_key, window_start) do update set request_count = excluded.request_count`,
          [
            `${prefix}${w.accountId}`,
            rateLimitWindowStart(Date.now(), windowMs).toISOString(),
            count,
          ],
        );
      // One below the bound, a report is made; at it, none is.
      await fill(bound - 1);
      expect((await post(audit())).status).toBe(201);
      await fill(bound);
      const before = await countReports();
      const objects = h.bucket.objects.size;
      const res = await post(audit());
      expect(await answer(res)).toEqual([429, { code: 'rate_limited' }]);
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(await countReports()).toBe(before);
      expect(h.bucket.objects.size).toBe(objects);
    },
  );

  it('marks failed a report of the account left pending by a request that ended', async () => {
    const pending = async (age: string) =>
      (
        await h.db.query<{ id: string }>(
          `insert into public.reports (id, account_id, site_id, kind, format, status, made_by,
                                       covers_check_ids, file_state, storage_path, created_at)
           select r.id, $1, $2, 'audit_pdf', 'pdf', 'ready', 'user', $3, 'pending',
                  public.report_file_path($1, r.id, 'pdf'), now() - $4::interval
             from (select gen_random_uuid() as id) r
           returning id`,
          [w.accountId, w.site.id, [w.site.first], age],
        )
      ).rows[0]!.id;
    const old = await pending('16 minutes');
    const recent = await pending('14 minutes');
    as(w.owner);
    expect((await post(audit())).status).toBe(201);
    expect(await reportById(old)).toMatchObject({
      file_state: 'failed',
      failed_reason: 'abandoned',
    });
    expect((await reportById(recent)).file_state).toBe('pending');
  });
});
