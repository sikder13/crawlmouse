import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { insertRow, prepareMeasurement, ROWS } from '../../../__tests__/helpers/v2-check-tables';
import { adminOver, keptSite, makePaid, person } from '../account/sites-test-support';
import { hashToken } from '../account/tokens';
import { runDueSchedules } from './schedules-run';
import { inngestClientReportMail, supabaseScheduleRunStore } from './schedules-store';

// The hourly run over the real SQL (CC-31 D8): the store is the PostgREST stand-in over PGlite with
// every migration applied, and the mail port is the production one with Inngest's send replaced by
// a recorder, so no mail is sent and no event leaves the test.

let db: PGlite;
const sent: { id: string; name: string; data: unknown }[] = [];
const mail = inngestClientReportMail(async (event) => {
  sent.push(event);
});
const capture = vi.fn(async (..._a: unknown[]) => undefined);

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  await prepareMeasurement(db);
}, 300_000);
afterAll(async () => db.close());

/** Monday 16 November 2026 09:04 UTC: four minutes after a weekly Monday 09:00 schedule's run. */
const RUN = new Date('2026-11-16T09:04:00.000Z');
const SAVED = '2026-11-12T12:00:00.000Z';
const run = (now = RUN) =>
  runDueSchedules({
    store: supabaseScheduleRunStore(adminOver(db)),
    mail,
    capture,
    now: () => now,
  });

async function client(contact: string | null, confirm: boolean) {
  const owner = await person(db, 'owner');
  await makePaid(db, owner.accountId, 'agency');
  const site = await keptSite(db, owner.accountId);
  if (contact) {
    await db.query(`select public.set_client($1, $2, $3::jsonb)`, [
      site.id,
      owner.accountId,
      JSON.stringify({ client_contact_email: contact }),
    ]);
  }
  await db.query(`select public.set_report_schedule($1, $2, $3::jsonb, $4)`, [
    site.id,
    owner.accountId,
    JSON.stringify({
      cadence: 'weekly',
      iso_weekday: 1,
      time_local: '09:00',
      timezone: 'UTC',
      send_when_unchanged: false,
    }),
    SAVED,
  ]);
  if (confirm) {
    const {
      rows: [issued],
    } = await db.query<{ r: { token: string } }>(
      `select public.issue_recipient_confirmation($1, $2) r`,
      [site.id, SAVED],
    );
    await db.query(`select public.confirm_report_recipient($1, $2)`, [
      hashToken(issued!.r.token),
      SAVED,
    ]);
  }
  const checkId = randomUUID();
  await insertRow(db, 'checks', {
    ...ROWS.checks(checkId, site.id),
    finished_at: '2026-11-15T06:20:00.000Z',
  });
  return { owner, siteId: site.id, checkId };
}

const reportsOf = async (siteId: string) =>
  (
    await db.query<{
      id: string;
      status: string;
      covers_check_ids: string[];
      recipient_email: string;
    }>(
      `select id, status, covers_check_ids, recipient_email from public.reports
        where site_id = $1 and kind = 'client_report'`,
      [siteId],
    )
  ).rows;
const nextRun = async (siteId: string) =>
  (
    await db.query<{ next_run_at: Date }>(
      `select next_run_at from public.report_schedules where site_id = $1`,
      [siteId],
    )
  ).rows[0]!.next_run_at.toISOString();

describe('the hourly run over the schedule functions', () => {
  it('writes the report row and asks for its mail for a confirmed contact, asks an unconfirmed one to confirm, and moves both schedules a week on', async () => {
    const ready = await client('reader@client.example', true);
    const pending = await client('new@client.example', false);
    const paused = await client('paused@client.example', true);
    const {
      rows: [link],
    } = await db.query<{ r: { token: string } }>(`select public.issue_report_pause($1, $2) r`, [
      paused.siteId,
      SAVED,
    ]);
    await db.query(`select public.pause_report_schedule($1, $2)`, [
      hashToken(link!.r.token),
      SAVED,
    ]);
    sent.length = 0;

    const counts = await run();
    expect(counts).toEqual({
      due: 2,
      sent: 0,
      queued: 1,
      confirmations: 1,
      skipped: { unconfirmed: 1 },
    });

    const [row] = await reportsOf(ready.siteId);
    expect(row).toMatchObject({
      status: 'scheduled',
      covers_check_ids: [ready.checkId],
      recipient_email: 'reader@client.example',
    });
    // Two schedules due at one moment run in the order of their site ids, which are random.
    expect([...sent].sort((x, y) => x.name.localeCompare(y.name))).toEqual([
      {
        id: `report_confirm:${pending.siteId}:2026-11-16T09:00:00.000Z`,
        name: 'report.confirmation.requested',
        data: { site_id: pending.siteId },
      },
      {
        id: `client_report:${row!.id}`,
        name: 'report.send.requested',
        data: { report_id: row!.id },
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain('@');
    expect(await reportsOf(pending.siteId)).toEqual([]);
    expect(await reportsOf(paused.siteId)).toEqual([]);
    expect(await nextRun(ready.siteId)).toBe('2026-11-23T09:00:00.000Z');
    expect(await nextRun(pending.siteId)).toBe('2026-11-23T09:00:00.000Z');
    expect(await nextRun(paused.siteId)).toBe('2026-11-16T09:00:00.000Z');

    // The same hour again: nothing is due, so nothing is asked for twice.
    sent.length = 0;
    expect((await run(new Date('2026-11-16T09:40:00.000Z'))).due).toBe(0);
    expect(sent).toEqual([]);
    expect(await reportsOf(ready.siteId)).toHaveLength(1);
    expect(capture).not.toHaveBeenCalled();
  });
});
