/**
 * The two mails of a client report schedule, over the real SQL (CC-31 D8): PGlite with every
 * migration applied, the production store (`supabaseReportMailStore`) through the PostgREST
 * stand-in as the service role, the report generator with a bucket in memory, and the mailer with
 * its ledger and transport in memory. The agency keeps the engine's recorded site, checked twice.
 */
import { createHash } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminOver } from '../lib/v2/account/sites-test-support';
import { reportMailHandlers } from '../lib/v2/mail/handlers';
import { memoryLedger, memoryTransport } from '../lib/v2/mail/memory';
import { supabaseReportMailStore } from '../lib/v2/mail/report-mail-store';
import { reportPauseToken } from '../lib/v2/mail/report-pause-token';
import type { MailDeps } from '../lib/v2/mail/send';
import { pgliteCheckReader } from '../lib/v2/pipeline/test-support/pglite';
import type { ReportDoc } from '../lib/v2/reports/generate';
import { generateReport, supabaseReportStore } from '../lib/v2/reports/generate-run';
import {
  memoryReportBucket,
  reportWorld,
  type ReportWorld,
} from '../lib/v2/reports/generate-test-support';
import { applyAllMigrations, freshDb } from './helpers/pglite-migrations';

const SECRET = 's'.repeat(40);
const PEPPER = 'p'.repeat(40);
const CONTACT = 'reader@client.example';
const SAVED = '2026-11-12T12:00:00.000Z';
/** Three Mondays, 09:00 UTC: the schedule's slots. */
const SLOTS = ['2026-11-16T09:00:00.000Z', '2026-11-23T09:00:00.000Z', '2026-11-30T09:00:00.000Z'];
const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

let db: PGlite;
let w: ReportWorld;
const memory = memoryReportBucket();

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  w = await reportWorld(db);
  await db.query(`update public.accounts set name = 'Summit Digital' where id = $1`, [w.accountId]);
  await db.query(`select public.set_client($1, $2, $3::jsonb)`, [
    w.site.id,
    w.accountId,
    JSON.stringify({ client_contact_email: CONTACT }),
  ]);
  await db.query(`select public.set_report_schedule($1, $2, $3::jsonb, $4)`, [
    w.site.id,
    w.accountId,
    JSON.stringify({
      cadence: 'weekly',
      iso_weekday: 1,
      time_local: '09:00',
      timezone: 'UTC',
      send_when_unchanged: true,
    }),
    SAVED,
  ]);
}, 300_000);
afterAll(async () => db.close());

const store = (linkSecret: string | null = SECRET) => {
  const admin = adminOver(db);
  return supabaseReportMailStore({
    admin,
    generate: (reportId) =>
      generateReport(
        {
          store: supabaseReportStore(admin),
          bucket: memory.bucket,
          read: pgliteCheckReader(db),
          home: 'https://crawlmouse.com/',
        },
        reportId,
      ),
    files: {
      read: async (path) => {
        const file = memory.objects.get(path);
        if (!file) throw new Error('no such object');
        return file.bytes;
      },
    },
    linkSecret,
  });
};

function mailer(at: Date) {
  const ledger = memoryLedger(new Set());
  const transport = memoryTransport();
  const capture = vi.fn(async () => undefined);
  const mail: MailDeps = { ledger, transport, pepper: PEPPER, now: () => at, log: () => {} };
  return {
    h: reportMailHandlers({ mail, store: store(), capture, pauseLinks: true }),
    transport,
    capture,
  };
}

const answer = async (sql: string, params: unknown[]) =>
  (await db.query<{ r: Record<string, unknown> }>(sql, params)).rows[0]!.r;
const writeReport = async (slot: string, checkId: string) =>
  (await answer(`select public.write_client_report($1, $2, $3, $2) r`, [w.site.id, slot, checkId]))
    .report_id as string;
const reportRow = async (id: string) =>
  (
    await db.query<{
      status: string;
      file_state: string;
      storage_path: string;
      sent_at: Date | null;
      covers_check_ids: string[];
    }>(
      `select status, file_state, storage_path, sent_at, covers_check_ids
         from public.reports where id = $1`,
      [id],
    )
  ).rows[0]!;
const schedule = async () =>
  (
    await db.query<{
      pause_token_hash: string | null;
      paused_by_recipient_at: Date | null;
      recipient_confirmed_at: Date | null;
    }>(
      `select pause_token_hash, paused_by_recipient_at, recipient_confirmed_at
         from public.report_schedules where site_id = $1`,
      [w.site.id],
    )
  ).rows[0]!;
const docAt = (path: string) =>
  JSON.parse(new TextDecoder().decode(memory.objects.get(path)!.bytes)) as ReportDoc;
/** The token of the one link in `text` under `path`: `length` base64url characters and no more. */
const tokenIn = (text: string, path: string, length: number) => {
  const link = new RegExp(
    `https://crawlmouse\\.com${path}([A-Za-z0-9_-]{${length}})(?![A-Za-z0-9_/-])`,
    'g',
  );
  const found = [...text.matchAll(link)];
  expect(new Set(found.map((m) => m[1])).size, path).toBe(1);
  return found[0]![1]!;
};

// One story, in order: each step reads what the one before wrote.
describe('a client report schedule’s mails, from the confirmation to a paused schedule', () => {
  const sent: { report: string; share: string; pause: string }[] = [];

  it('the confirmation goes to the contact with a link that confirms, once for one request', async () => {
    const at = new Date('2026-11-12T12:01:00.000Z');
    const { h, transport } = mailer(at);
    expect(await h.reportConfirm(w.site.id, 'req-1')).toBe('sent');
    expect(await h.reportConfirm(w.site.id, 'req-1')).toBe('done');
    expect(transport.sent).toHaveLength(1);
    const m = transport.sent[0]!;
    expect(m.to).toBe(CONTACT);
    expect(m.text).toContain('Summit Digital');
    const token = tokenIn(m.text, '/s/confirm/', 43);
    expect(
      await answer(`select public.read_report_link($1, $2) r`, [sha256(token), at]),
    ).toMatchObject({ outcome: 'confirm' });
    // No report is mailed to a contact that has not confirmed.
    const early = await writeReport('2026-11-09T09:00:00.000Z', w.site.first);
    expect(await store().issueClientReport(early, at)).toBeNull();
    await db.query(`delete from public.reports where id = $1`, [early]);

    await answer(`select public.confirm_report_recipient($1, $2) r`, [sha256(token), at]);
    expect((await schedule()).recipient_confirmed_at).not.toBeNull();
    // Confirmed: a second confirmation has nothing to send.
    expect(await h.reportConfirm(w.site.id, 'req-2')).toBe('nothing_to_send');
  });

  it('the first report is mailed with its stored document’s own title and lines, a link that opens it and the pause link, and is then marked sent', async () => {
    const at = new Date('2026-11-16T09:05:00.000Z');
    const report = await writeReport(SLOTS[0]!, w.site.first);
    const before = await reportRow(report);
    expect(before).toMatchObject({ status: 'scheduled', file_state: 'pending' });
    expect(memory.objects.has(before.storage_path)).toBe(false);

    const { h, transport, capture } = mailer(at);
    expect(await h.clientReport(report)).toBe('sent');
    expect(transport.sent).toHaveLength(1);
    const m = transport.sent[0]!;
    expect(m.to).toBe(CONTACT);

    // The document is stored at the row's own path, and the mail says what it says.
    const doc = docAt(before.storage_path);
    expect(await reportRow(report)).toMatchObject({ status: 'sent', file_state: 'stored' });
    expect((await reportRow(report)).sent_at!.toISOString()).toBe(at.toISOString());
    expect(m.text).toContain([doc.title, ...doc.lines].join('\n'));
    expect(m.text).toContain(doc.footer.text);

    // The report's link opens this report; only its sha256 is stored.
    const share = tokenIn(m.text, '/s/', 22);
    expect(
      await answer(`select public.read_share_link($1, $2) r`, [sha256(share), at]),
    ).toMatchObject({ outcome: 'open', report_id: report, storage_path: before.storage_path });
    expect(
      (await db.query(`select 1 from public.share_links where token_hash = $1`, [share])).rows,
    ).toEqual([]);

    // The pause link is the derived one, in the body and as the one-click header.
    const pause = tokenIn(m.text, '/s/pause/', 43);
    expect(pause).toBe(reportPauseToken(SECRET, w.site.id, CONTACT));
    expect(m.headers).toEqual({
      'List-Unsubscribe': `<https://crawlmouse.com/s/pause/${pause}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect((await schedule()).pause_token_hash).toBe(sha256(pause));
    expect(capture.mock.calls).toEqual([['first_client_report_sent', w.accountId, {}]]);
    sent.push({ report, share, pause });
  });

  it('the event again sends nothing more and leaves the link that was mailed working', async () => {
    const at = new Date('2026-11-16T09:20:00.000Z');
    // A new mailer with the same ledger would answer `done`; a report already sent has no reader.
    const { h, transport } = mailer(at);
    expect(await h.clientReport(sent[0]!.report)).toBe('not_found');
    expect(transport.sent).toEqual([]);
    expect(
      await answer(`select public.read_share_link($1, $2) r`, [sha256(sent[0]!.share), at]),
    ).toMatchObject({ outcome: 'open' });
  });

  it('the next report compares with the check the last one ended on, has its own link, and carries the same pause link', async () => {
    const at = new Date('2026-11-23T09:05:00.000Z');
    const report = await writeReport(SLOTS[1]!, w.site.second);
    expect((await reportRow(report)).covers_check_ids).toEqual([w.site.first, w.site.second]);
    const { h, transport, capture } = mailer(at);
    expect(await h.clientReport(report)).toBe('sent');
    const m = transport.sent[0]!;
    const [share, pause] = [tokenIn(m.text, '/s/', 22), tokenIn(m.text, '/s/pause/', 43)];
    expect(share).not.toBe(sent[0]!.share);
    expect(pause).toBe(sent[0]!.pause);
    // A comparison's document, not the first report's again.
    const [first, second] = [sent[0]!.report, report].map(async (id) =>
      docAt((await reportRow(id)).storage_path),
    );
    expect((await second)!.title).not.toBe((await first)!.title);
    // Not the account's first report: nothing is captured.
    expect(capture).not.toHaveBeenCalled();
    sent.push({ report, share, pause });
  });

  it('the pause link of the first report still pauses, and a paused schedule is mailed nothing', async () => {
    const at = new Date('2026-11-24T08:00:00.000Z');
    expect(
      await answer(`select public.pause_report_schedule($1, $2) r`, [sha256(sent[0]!.pause), at]),
    ).toEqual({ outcome: 'paused' });
    expect((await schedule()).paused_by_recipient_at).not.toBeNull();

    const report = await writeReport(SLOTS[2]!, w.site.second);
    const { h, transport } = mailer(new Date('2026-11-30T09:05:00.000Z'));
    expect(await h.clientReport(report)).toBe('nothing_to_send');
    expect(transport.sent).toEqual([]);
    // Nothing was made for it: no document, no link, and the row still waits.
    const row = await reportRow(report);
    expect(row).toMatchObject({ status: 'scheduled', file_state: 'pending' });
    expect(memory.objects.has(row.storage_path)).toBe(false);
    expect(
      (await db.query(`select 1 from public.share_links where report_id = $1`, [report])).rows,
    ).toEqual([]);
  });
});

describe('the pause link’s token', () => {
  const SITE = '50000000-0000-4000-8000-000000000001';
  const OTHER = '50000000-0000-4000-8000-000000000002';

  it('is 43 base64url characters, the same for one site and address whatever the address’s case', () => {
    const t = reportPauseToken(SECRET, SITE, CONTACT);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(reportPauseToken(SECRET, SITE, ` ${CONTACT.toUpperCase()} `)).toBe(t);
  });

  it('differs for another site, another address and another secret, and refuses a value that is not a site id', () => {
    const t = reportPauseToken(SECRET, SITE, CONTACT);
    expect(reportPauseToken(SECRET, OTHER, CONTACT)).not.toBe(t);
    expect(reportPauseToken(SECRET, SITE, 'other@client.example')).not.toBe(t);
    expect(reportPauseToken('t'.repeat(40), SITE, CONTACT)).not.toBe(t);
    expect(() => reportPauseToken(SECRET, 'x', CONTACT)).toThrow(RangeError);
  });

  it('with no secret the store issues no report', async () => {
    await expect(store(null).issueClientReport(SITE, new Date())).rejects.toThrow(/no link secret/);
  });
});
