import type { PGlite } from '@electric-sql/pglite';
import type { BuildInput, BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { adminOver, makePaid, person, type Person } from '../account/sites-test-support';
import { memoryEvidenceStore } from '../pipeline/test-support/memory-evidence';
import { pgliteCheckReader } from '../pipeline/test-support/pglite';
import {
  FIRST,
  keepSite,
  persistBuild,
  SECOND,
  secondInput,
} from '../pipeline/test-support/public-checks';
import type { CheckReader } from '../pipeline/types';
import { REPORTS_BUCKET, reportPath, type ReportDoc, type ReportFile } from './generate';
import { memoryReportBucket } from './generate-test-support';
import {
  generateReport,
  supabaseReportBucket,
  supabaseReportStore,
  type GenerateDeps,
  type NewReport,
  type ReportStore,
} from './generate-run';

/**
 * Making a report's file over PGlite with every migration applied: the engine's recorded site kept
 * by a Pro account, checked three times (its re-check verifies the orphan fix; the third finds what
 * the second found), read back as the pipeline's tests read a check (`pgliteCheckReader`). The store
 * is the PostgREST stand-in as the service role; the bucket is a map in memory.
 */

const THIRD = 'b0000000-0000-4000-8000-0000000000c3';
const HOME = 'https://crawlmouse.com/';

/** The second check's crawl again, as the site's third check. */
function thirdInput(second: BuiltCheck): BuildInput {
  const input = secondInput(second);
  return {
    ...input,
    check: {
      ...input.check,
      id: THIRD,
      previous_check_id: SECOND,
      trigger: 'scheduled',
      queued_at: '2026-11-07T10:00:00Z',
      started_at: '2026-11-07T10:00:02Z',
      finished_at: '2026-11-07T10:11:00Z',
    },
    batches: JSON.parse(JSON.stringify(input.batches).replaceAll(SECOND, THIRD)) as unknown[],
    now: '2026-11-07T10:11:00Z',
  };
}

let db: PGlite;
let owner: Person;
let siteId: string;
let first: BuiltCheck;
let second: BuiltCheck;
let store: ReportStore;
let read: CheckReader;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  owner = await person(db, 'owner');
  await makePaid(db, owner.accountId, 'pro');
  const evidence = memoryEvidenceStore();
  const input = recordedBuild();
  siteId = input.site.id;
  first = await persistBuild(db, evidence, input);
  await keepSite(db, siteId, owner.accountId);
  second = await persistBuild(db, evidence, secondInput(first), { siteSeeded: true });
  await persistBuild(db, evidence, thirdInput(second), { siteSeeded: true });
  await keepSite(db, siteId, owner.accountId);
  store = supabaseReportStore(adminOver(db));
  read = pgliteCheckReader(db);
}, 300_000);
afterAll(async () => db.close());

const request = (over: Partial<NewReport> = {}): NewReport => ({
  account_id: owner.accountId,
  site_id: siteId,
  kind: 'audit_pdf',
  format: 'pdf',
  covers_check_ids: [FIRST],
  ...over,
});

async function make(over: Partial<NewReport>, deps: Partial<GenerateDeps> = {}) {
  const id = (await store.create(request(over)))!;
  const memory = memoryReportBucket();
  const made = await generateReport(
    { store, bucket: memory.bucket, read, home: HOME, ...deps },
    id,
  );
  return { id, made, objects: memory.objects, memory };
}

async function row(id: string) {
  const { rows } = await db.query<{
    file_state: string;
    storage_path: string | null;
    byte_count: number | null;
    failed_reason: string | null;
  }>(
    `select file_state, storage_path, byte_count::int as byte_count, failed_reason
       from public.reports where id = $1`,
    [id],
  );
  return rows[0]!;
}

const docIn = (file: ReportFile): ReportDoc =>
  JSON.parse(new TextDecoder().decode(file.bytes)) as ReportDoc;
const textIn = (file: ReportFile) => new TextDecoder().decode(file.bytes);

describe('generateReport', () => {
  it('stores the audit as a PDF at the report’s own path, and marks the row stored with its size', async () => {
    const { id, made, objects } = await make({});
    const path = reportPath(owner.accountId, id, 'pdf');
    expect([...objects.keys()]).toEqual([path]);
    const file = objects.get(path)!;
    expect(file.contentType).toBe('application/pdf');
    expect(made).toEqual({ outcome: 'stored', bytes: file.bytes.length });
    expect(await row(id)).toEqual({
      file_state: 'stored',
      storage_path: path,
      byte_count: file.bytes.length,
      failed_reason: null,
    });
    const pdf = await PDFDocument.load(file.bytes);
    expect(pdf.getTitle()).toBe('Audit report');
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });

  it('stores a raw export in each format, of the check the row covers', async () => {
    const pages = first.page_results.length;
    const csv = await make({ kind: 'raw_export', format: 'csv' });
    const csvFile = csv.objects.get(reportPath(owner.accountId, csv.id, 'csv'))!;
    expect(csvFile.contentType).toBe('text/csv; charset=utf-8');
    expect(textIn(csvFile).split('\r\n')).toHaveLength(pages + 2);
    expect(textIn(csvFile).split('\r\n')[1]).toMatch(/^"https:\/\/built-site\.test","https:/);

    const edges = await make({ kind: 'raw_export', format: 'edge_list' });
    const edgeFile = edges.objects.get(reportPath(owner.accountId, edges.id, 'edge_list'))!;
    expect(textIn(edgeFile).split('\r\n')).toHaveLength(first.link_edges.length + 2);

    const json = await make({ kind: 'raw_export', format: 'json', covers_check_ids: [SECOND] });
    const jsonFile = json.objects.get(reportPath(owner.accountId, json.id, 'json'))!;
    expect(jsonFile.contentType).toBe('application/json');
    const parsed = JSON.parse(textIn(jsonFile)) as {
      check: { id: string };
      page_results: { check_id: string }[];
    };
    expect(parsed.check.id).toBe(SECOND);
    expect(parsed.page_results.length).toBe(second.page_results.length);
    expect(new Set(parsed.page_results.map((p) => p.check_id))).toEqual(new Set([SECOND]));
    for (const made of [csv, edges, json]) expect((await row(made.id)).file_state).toBe('stored');
  });

  it('stores a compare of one check as its baseline document', async () => {
    const { id, objects } = await make({ kind: 'compare', format: 'html' });
    const file = objects.get(reportPath(owner.accountId, id, 'html'))!;
    expect(file.contentType).toBe('application/json');
    const doc = docIn(file);
    expect(doc.title).toBe('Baseline');
    expect(doc.lines[0]).toBe('built-site.test');
  });

  it('stores a compare of two checks, the earlier first whatever their order on the row', async () => {
    for (const covers of [
      [FIRST, SECOND],
      [SECOND, FIRST],
    ]) {
      const { id, objects } = await make({
        kind: 'compare',
        format: 'html',
        covers_check_ids: covers,
      });
      const doc = docIn(objects.get(reportPath(owner.accountId, id, 'html'))!);
      expect(doc.title).toBe('Before and after');
      const moved = doc.sections.find((s) => s.heading === 'What moved')!;
      expect(moved.blocks.filter((b) => b.type === 'pair').map((b) => b.title)).toEqual(
        second.changes.map((c) => c.summary),
      );
      expect(second.changes.length).toBeGreaterThan(0);
    }
  });

  it('lists, in a compare across three checks, the changes the check between them found', async () => {
    const { id, objects } = await make({
      kind: 'compare',
      format: 'html',
      covers_check_ids: [FIRST, THIRD],
    });
    const doc = docIn(objects.get(reportPath(owner.accountId, id, 'html'))!);
    const moved = doc.sections.find((s) => s.heading === 'What moved')!;
    const titles = moved.blocks.filter((b) => b.type === 'pair').map((b) => b.title);
    const { rows } = await db.query<{ check_id: string; summary: string }>(
      `select check_id, summary from public.changes where check_id = any($1)`,
      [[SECOND, THIRD]],
    );
    expect(titles.sort()).toEqual(rows.map((r) => r.summary).sort());
    expect(rows.some((r) => r.check_id === SECOND)).toBe(true);
    // One headline per check after the first.
    expect(moved.blocks.filter((b) => b.type === 'text')).toHaveLength(2);
  });

  it('stores the proof of a fix the later check verified', async () => {
    const verified = second.fix_events.find((e) => e.kind === 'verified')!;
    const { id, made, objects } = await make({
      kind: 'compare',
      format: 'html',
      covers_check_ids: [FIRST, SECOND],
      subject_fix_id: verified.fix_id,
    });
    expect(made.outcome).toBe('stored');
    const doc = docIn(objects.get(reportPath(owner.accountId, id, 'html'))!);
    expect(doc.title).toBe('Fix verified');
    expect(doc.lines).toEqual([
      'built-site.test',
      'Bring https://built-site.test/products/forgotten-lantern within 3 clicks of the homepage.',
    ]);
  });

  it('marks the row build_failed, with nothing of what was thrown, and stores no file', async () => {
    const stillOpen = second.fixes.find((f) => f.status === 'open')!;
    const unverified = await make({
      kind: 'compare',
      format: 'html',
      covers_check_ids: [FIRST, SECOND],
      subject_fix_id: stillOpen.id,
    });
    expect(unverified.made).toEqual({ outcome: 'failed', reason: 'build_failed' });
    expect(unverified.objects.size).toBe(0);
    expect(await row(unverified.id)).toEqual({
      file_state: 'failed',
      storage_path: null,
      byte_count: null,
      failed_reason: 'build_failed',
    });

    const throwing: CheckReader = {
      rows: async () => {
        throw new Error('reading <title>Buy now at https://built-site.test/</title>');
      },
    };
    const unread = await make({}, { read: throwing });
    expect(unread.made).toEqual({ outcome: 'failed', reason: 'build_failed' });
    expect((await row(unread.id)).failed_reason).toBe('build_failed');
  });

  it('marks the row store_failed when the bucket refuses the file, and leaves no object', async () => {
    const id = (await store.create(request()))!;
    const memory = memoryReportBucket();
    memory.state.refuse = true;
    const made = await generateReport({ store, bucket: memory.bucket, read, home: HOME }, id);
    expect(made).toEqual({ outcome: 'failed', reason: 'store_failed' });
    expect(memory.objects.size).toBe(0);
    expect(await row(id)).toMatchObject({
      file_state: 'failed',
      storage_path: null,
      failed_reason: 'store_failed',
    });
  });

  it('an upload followed by a failing finish_report leaves no object and a failed row', async () => {
    const failing: ReportStore = {
      ...store,
      finish: async () => {
        throw new Error('finish_report: connection reset');
      },
    };
    const { id, made, memory } = await make({}, { store: failing });
    expect(made).toEqual({ outcome: 'failed', reason: 'store_failed' });
    expect(memory.state.puts).toBe(1);
    expect(memory.objects.size).toBe(0);
    expect(await row(id)).toEqual({
      file_state: 'failed',
      storage_path: null,
      byte_count: null,
      failed_reason: 'store_failed',
    });
  });

  it('when the removal fails too, the row records that an object was left, at the report’s own name', async () => {
    const id = (await store.create(request()))!;
    const memory = memoryReportBucket();
    memory.state.refuseRemoval = true;
    const failing: ReportStore = {
      ...store,
      finish: async () => {
        throw new Error('finish_report: connection reset');
      },
    };
    const made = await generateReport(
      { store: failing, bucket: memory.bucket, read, home: HOME },
      id,
    );
    expect(made).toEqual({ outcome: 'failed', reason: 'object_left' });
    expect([...memory.objects.keys()]).toEqual([reportPath(owner.accountId, id, 'pdf')]);
    expect(await row(id)).toMatchObject({ file_state: 'failed', failed_reason: 'object_left' });
  });

  it('a retry of the same report overwrites the same name: one object, whatever the first attempt left', async () => {
    const id = (await store.create(request()))!;
    const path = reportPath(owner.accountId, id, 'pdf');
    const memory = memoryReportBucket();
    // The first attempt: the database stops answering once the file is up, and the removal fails.
    memory.state.refuseRemoval = true;
    const down = async (): Promise<never> => {
      throw new Error('the database did not answer');
    };
    let reads = 0;
    const stopping: ReportStore = {
      ...store,
      report: (reportId) => (reads++ === 0 ? store.report(reportId) : down()),
      finish: down,
      fail: down,
    };
    await expect(
      generateReport({ store: stopping, bucket: memory.bucket, read, home: HOME }, id),
    ).rejects.toThrow(/did not answer/);
    expect([...memory.objects.keys()]).toEqual([path]);
    expect((await row(id)).file_state).toBe('pending');
    const left = memory.objects.get(path);

    memory.state.refuseRemoval = false;
    const made = await generateReport({ store, bucket: memory.bucket, read, home: HOME }, id);
    expect(made.outcome).toBe('stored');
    expect(memory.state.puts).toBe(2);
    expect([...memory.objects.keys()]).toEqual([path]);
    expect(memory.objects.get(path)).not.toBe(left);
    expect(await row(id)).toMatchObject({ file_state: 'stored', storage_path: path });
  });

  it('keeps the object the row names: a finish_report that took although its answer was lost', async () => {
    const lost: ReportStore = {
      ...store,
      finish: async (reportId, path, bytes) => {
        await store.finish(reportId, path, bytes);
        throw new Error('finish_report: the answer was lost');
      },
    };
    const { id, made, memory } = await make({}, { store: lost });
    const path = reportPath(owner.accountId, id, 'pdf');
    expect(made).toEqual({ outcome: 'stored', bytes: memory.objects.get(path)!.bytes.length });
    expect([...memory.objects.keys()]).toEqual([path]);
    expect(await row(id)).toMatchObject({ file_state: 'stored', storage_path: path });
  });

  it('keeps the object the row names: another run stored the same report first', async () => {
    const id = (await store.create(request()))!;
    const path = reportPath(owner.accountId, id, 'pdf');
    const memory = memoryReportBucket();
    const overtaken: GenerateDeps['bucket'] = {
      async put(at, file) {
        await memory.bucket.put(at, file);
        await store.finish(id, at, file.bytes.length);
      },
      remove: memory.bucket.remove,
    };
    expect(await generateReport({ store, bucket: overtaken, read, home: HOME }, id)).toEqual({
      outcome: 'not_pending',
    });
    expect([...memory.objects.keys()]).toEqual([path]);
    expect(await row(id)).toMatchObject({ file_state: 'stored', storage_path: path });
  });

  it('builds and stores nothing for a report that is not pending, so a stored file is not written again', async () => {
    const { id, memory } = await make({});
    const before = await row(id);
    const file = memory.objects.get(reportPath(owner.accountId, id, 'pdf'));
    expect(memory.state.puts).toBe(1);
    const deps = { store, bucket: memory.bucket, read, home: HOME };
    expect(await generateReport(deps, id)).toEqual({ outcome: 'not_pending' });
    expect(memory.state.puts).toBe(1);
    expect(memory.objects.get(reportPath(owner.accountId, id, 'pdf'))).toBe(file);
    expect(await row(id)).toEqual(before);

    const failed = (await store.create(request()))!;
    await store.fail(failed, 'build_failed');
    expect(await generateReport(deps, failed)).toEqual({ outcome: 'not_pending' });
    expect(await generateReport(deps, '00000000-0000-4000-8000-000000000000')).toEqual({
      outcome: 'not_pending',
    });
    expect(memory.state.puts).toBe(1);
  });

  it('removes the object when the row stopped being pending while the file was made', async () => {
    const id = (await store.create(request()))!;
    const memory = memoryReportBucket();
    const racing: GenerateDeps['bucket'] = {
      async put(path, file) {
        await memory.bucket.put(path, file);
        await store.failAbandoned(owner.accountId, new Date(Date.now() + 60_000));
      },
      remove: memory.bucket.remove,
    };
    expect(await generateReport({ store, bucket: racing, read, home: HOME }, id)).toEqual({
      outcome: 'not_pending',
    });
    expect(memory.state.puts).toBe(1);
    expect(memory.objects.size).toBe(0);
    expect(await row(id)).toMatchObject({
      file_state: 'failed',
      failed_reason: 'abandoned',
      storage_path: null,
    });
  });
});

describe('supabaseReportStore', () => {
  it('create answers null for a check of another site, and throws for a request the function does not make', async () => {
    const other = await person(db, 'other');
    expect(await store.create(request({ account_id: other.accountId }))).toBeNull();
    expect(
      await store.create(request({ covers_check_ids: ['00000000-0000-4000-8000-000000000000'] })),
    ).toBeNull();
    await expect(store.create(request({ kind: 'audit_pdf', format: 'csv' }))).rejects.toThrow(
      /create_report: 22023/,
    );
  });

  it('report answers null for a row with no file to make', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.reports (account_id, site_id, kind, format, status, made_by,
                                   covers_check_ids, public_slug)
       values ($1, $2, 'public_link', 'html', 'ready', 'user', $3, 'a-public-link') returning id`,
      [owner.accountId, siteId, [FIRST]],
    );
    expect(await store.report(rows[0]!.id)).toBeNull();
  });
});

describe('supabaseReportBucket', () => {
  type Call = [method: string, ...args: unknown[]];

  function fakeStorage(
    answers: Partial<Record<string, { data?: unknown; error?: { message: string } | null }>>,
  ) {
    const calls: Call[] = [];
    const answer = (method: string, ...args: unknown[]) => {
      calls.push([method, ...args]);
      return Promise.resolve({ data: null, error: null, ...answers[method] });
    };
    const client = {
      storage: {
        from: (bucket: string) => ({
          upload: (...a: unknown[]) => answer('upload', bucket, ...a),
          remove: (...a: unknown[]) => answer('remove', bucket, ...a),
          createSignedUrl: (...a: unknown[]) => answer('createSignedUrl', bucket, ...a),
        }),
      },
    };
    return { calls, bucket: supabaseReportBucket(client as never) };
  }

  it('puts over what is there, removes and signs, in the private reports bucket', async () => {
    const { calls, bucket } = fakeStorage({
      createSignedUrl: { data: { signedUrl: 'https://storage.example/signed' } },
    });
    const bytes = new Uint8Array([1, 2, 3]);
    await bucket.put('a/b.pdf', { bytes, contentType: 'application/pdf' });
    await bucket.remove('a/b.pdf');
    expect(await bucket.signedUrl('a/b.pdf', 600)).toBe('https://storage.example/signed');
    expect(REPORTS_BUCKET).toBe('reports');
    expect(calls).toEqual([
      ['upload', 'reports', 'a/b.pdf', bytes, { upsert: true, contentType: 'application/pdf' }],
      ['remove', 'reports', ['a/b.pdf']],
      ['createSignedUrl', 'reports', 'a/b.pdf', 600, { download: true }],
    ]);
  });

  it('throws when Storage refuses', async () => {
    const refused = { error: { message: 'no' } };
    const { bucket } = fakeStorage({ upload: refused, remove: refused, createSignedUrl: refused });
    const file = { bytes: new Uint8Array(), contentType: 'application/pdf' };
    await expect(bucket.put('a/b.pdf', file)).rejects.toThrow(/put/);
    await expect(bucket.remove('a/b.pdf')).rejects.toThrow(/remove/);
    await expect(bucket.signedUrl('a/b.pdf', 600)).rejects.toThrow(/sign/);
  });
});
