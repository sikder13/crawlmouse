/**
 * What the client reports page reads beside the account's records (CC-31 D8).
 *
 * `loadAccountDataset` reads the sites' reports of kind `public_link` (lib/v2/account/dataset.ts),
 * so the client reports that were sent for those sites are read here, through the caller's own
 * session: row security decides which of them a seat reads, and a report's `recipient_email`
 * reaches the page from that read.
 *
 * The service role then reads three things by ids the caller's session returned. For the sites: when
 * each schedule runs next, and when its contact was asked and confirmed, two columns that
 * `infra/supabase/checks/01-client-table-privileges.sql` does not list among those a client role
 * reads; and which contacts may not be asked to confirm, as `report_ask_refusals` answers it (the
 * answer says why and holds no address). For the reports the page lists: whether each one's
 * document is stored.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { reportFromRow } from '../account/rows';
import { instantFromDb } from '../pipeline/rows';
import { reportFileStates } from '../reports/share-proof';
import { askRefusals } from './schedules-store';
import type { AccountDataset } from '../view/account';
import { shownSent, type ClientReportsSide, type ScheduleSide } from '../view/agency-reports';

type Row = Record<string, unknown>;

const REPORT_COLUMNS =
  'id, account_id, site_id, kind, format, status, made_by, created_at, covers_check_ids, ' +
  'byte_count, share_expires_at, public_slug, scheduled_for, sent_at, recipient_email, ' +
  'owner_seat_id, headline, open_tracking, opened_at';
const SCHEDULE_COLUMNS = 'site_id, next_run_at, recipient_confirm_sent_at, recipient_confirmed_at';

/** Rows asked for per request; PostgREST answers at most its max-rows setting. */
const PAGE = 1000;
/** Site ids per `in` filter, which travels in the URL. */
const IDS_PER_REQUEST = 100;

/** `all` in runs of at most `size`, in order. */
function chunks<T>(all: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (const [i, x] of all.entries()) {
    if (i % size === 0) out.push([]);
    out.at(-1)!.push(x);
  }
  return out;
}

const instantOrNull = (v: unknown): string | null => (v === null ? null : instantFromDb(v));

/**
 * The client reports sent for `siteIds`, as the caller's session reads them, read page after page
 * in id order until a page comes back empty. A server row cap below PAGE then shortens the pages
 * and not the list, whose length the page states (client-reports-read.test.ts pages a list).
 */
async function sentClientReports(session: SupabaseClient, siteIds: readonly string[]) {
  const out: Row[] = [];
  for (const ids of chunks(siteIds, IDS_PER_REQUEST)) {
    for (let from = 0; ; ) {
      const { data, error } = await session
        .from('reports')
        .select(REPORT_COLUMNS)
        .in('site_id', ids)
        .eq('kind', 'client_report')
        .eq('status', 'sent')
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`client reports: reports read failed: ${error.message}`);
      const rows = (data ?? []) as unknown as Row[];
      if (rows.length === 0) break;
      out.push(...rows);
      from += rows.length;
    }
  }
  return out.map(reportFromRow);
}

/** The run and confirmation columns of each schedule of `siteIds`, by site id. */
async function scheduleSides(
  admin: SupabaseClient,
  siteIds: readonly string[],
): Promise<Map<string, ScheduleSide>> {
  const sides = new Map<string, ScheduleSide>();
  for (const ids of chunks(siteIds, IDS_PER_REQUEST)) {
    const { data, error } = await admin
      .from('report_schedules')
      .select(SCHEDULE_COLUMNS)
      .in('site_id', ids);
    if (error) throw new Error(`client reports: report_schedules read failed: ${error.message}`);
    for (const r of (data ?? []) as unknown as Row[]) {
      sides.set(r.site_id as string, {
        nextRunAt: instantOrNull(r.next_run_at),
        confirmSentAt: instantOrNull(r.recipient_confirm_sent_at),
        confirmedAt: instantOrNull(r.recipient_confirmed_at),
      });
    }
  }
  return sides;
}

export interface ClientReportsRead {
  /** The account's records, with the client reports sent for its sites added. */
  d: AccountDataset;
  side: ClientReportsSide;
}

/**
 * `d` (what `readAccount` returned for the caller) with the sent client reports of its sites, and
 * what the page hands the view beside it. The service role's two reads are keyed by the site ids of
 * `d` and by the ids of reports `session` returned; `app/agency/reports/page.test.tsx` reads the
 * requests a scoped seat's page makes.
 */
export async function readClientReports(
  deps: {
    /** The caller's own client: row security applies. */
    session: SupabaseClient;
    /** The service role. */
    admin: SupabaseClient;
    /** The moment the refusals are read at; now, unless a test gives one. */
    now?: () => Date;
  },
  d: AccountDataset,
): Promise<ClientReportsRead> {
  const siteIds = d.sites.map((s) => s.id);
  if (siteIds.length === 0) {
    return { d, side: { schedules: new Map(), fileStates: new Map(), refusals: new Map() } };
  }
  const [reports, schedules, refusals] = await Promise.all([
    sentClientReports(deps.session, siteIds),
    scheduleSides(deps.admin, siteIds),
    askRefusals(deps.admin, siteIds, deps.now?.() ?? new Date()),
  ]);
  return {
    d: { ...d, reports: [...d.reports, ...reports] },
    side: {
      schedules,
      refusals,
      fileStates: await reportFileStates(deps.admin, shownSent(reports).shown),
    },
  };
}
