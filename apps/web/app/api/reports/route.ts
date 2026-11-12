import { checksPublicEnabled } from '@/lib/auth/flags';
import { seeOther } from '@/lib/billing/request-body';
import { checkRateLimit } from '@/lib/rate-limit';
import { siteUrl } from '@/lib/site-url';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { notFound, paywall, readBody, refuse } from '@/lib/v2/account/route';
import { readSite } from '@/lib/v2/account/sites';
import { readEntitlement } from '@/lib/v2/account/viewer';
import { agencyCaptureFor } from '@/lib/v2/agency/events';
import { supabaseCheckReader } from '@/lib/v2/pipeline/load';
import {
  earlierFirst,
  formatOf,
  parseReportRequest,
  readResultChecks,
} from '@/lib/v2/reports/generate-request';
import {
  generateReport,
  supabaseReportBucket,
  supabaseReportStore,
} from '@/lib/v2/reports/generate-run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A report is made inside the request (docs/specs/v2/31-agency.md §9 has the measured times).
export const maxDuration = 60;

/** Reports an account may ask for in an hour, failing closed. */
const PER_ACCOUNT_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;
/**
 * A report still pending this long after it was asked for was left by a request that has ended
 * (`maxDuration` above is a minute): the account's next request marks it failed.
 */
const ABANDONED_AFTER_MS = 15 * 60 * 1000;

/**
 * Makes a report from a site's checks (CC-31 D6): an audit as a PDF, a comparison or a baseline as
 * a proof page's document, or a raw export.
 *
 * In order: 404 with V2_CHECKS_PUBLIC unset; 401 signed out; 400 `invalid` for a body that is not
 * one of the requests; 501 `not_available` for a prospect's one-pager, which is not built; 404 for
 * a site the caller's seat does not cover or a removed one, and for a check (or the fix) that is
 * not a result of that site as the caller's own session reads it; 403 `role_refused` for a role
 * `seat_may` refuses `export_report`; 402 `exports` when the site's account's tier has no exports;
 * 429 `rate_limited` past the account's hourly bound. Only then is the service-role client made:
 * the row is written (`create_report`, which checks the checks against the site again), the file
 * made and stored, and `report_generated` sent. The answer is 201 `{reportId}` to JSON and a 303
 * to `/reports` to a form; when the file could not be made the row is left failed, and JSON gets
 * 500 `report_failed` with the row's id.
 */
export async function POST(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  const body = await readBody(req);
  const request = body === null ? null : parseReportRequest(body.fields);
  if (body === null || request === null) return refuse(400, 'invalid');
  if (request.kind === 'prospect_one_pager') return refuse(501, 'not_available');

  const { siteId } = request;
  const { data: member, error: memberError } = await sb.rpc('is_member_for_site', {
    p_site: siteId,
  });
  if (memberError) throw new Error(`is_member_for_site failed: ${memberError.message}`);
  if (member !== true) return notFound();
  const site = await readSite(sb, siteId);
  if (site === null || site.removed_at !== null) return notFound();

  const fixId = request.kind === 'compare' ? request.fixId : undefined;
  if (fixId !== undefined) {
    const { data: ofFix, error: fixError } = await sb.rpc('is_member_for_fix', { p_fix: fixId });
    if (fixError) throw new Error(`is_member_for_fix failed: ${fixError.message}`);
    if (ofFix !== true) return notFound();
  }
  const later = await readResultChecks(sb, siteId, [request.checkId]);
  if (later === null) return notFound();
  // The earlier check: the one the request names, or for a fix the check the later one was
  // compared with when it verified the fix.
  const earlierId =
    request.kind !== 'compare'
      ? undefined
      : fixId !== undefined
        ? (later[0]!.previous_check_id ?? null)
        : request.previousCheckId;
  if (earlierId === null || earlierId === request.checkId) return refuse(400, 'invalid');
  const earlier = earlierId === undefined ? [] : await readResultChecks(sb, siteId, [earlierId]);
  if (earlier === null) return notFound();

  const { data: allowed, error: guardError } = await sb.rpc('seat_may', {
    p_account: site.account_id,
    p_action: 'export_report',
  });
  if (guardError) throw new Error(`seat_may failed: ${guardError.message}`);
  if (allowed !== true) return refuse(403, 'role_refused');
  const entitlement = await readEntitlement(sb, site.account_id, new Date());
  if (entitlement === null) return notFound();
  if (!entitlement.gates.exports) return paywall('exports');

  const limit = await checkRateLimit(
    `reports:account:${site.account_id}`,
    PER_ACCOUNT_HOUR,
    HOUR_MS,
    { failClosed: true },
  );
  if (!limit.allowed) {
    const seconds = Math.max(1, Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000));
    return refuse(429, 'rate_limited', {}, { 'retry-after': String(seconds) });
  }

  const admin = supabaseAdmin();
  const store = supabaseReportStore(admin);
  await store.failAbandoned(site.account_id, new Date(Date.now() - ABANDONED_AFTER_MS));
  const format = formatOf(request);
  const reportId = await store.create({
    account_id: site.account_id,
    site_id: siteId,
    kind: request.kind,
    format,
    covers_check_ids: earlierFirst([...earlier, ...later]).map((c) => c.id),
    ...(fixId === undefined ? {} : { subject_fix_id: fixId }),
  });
  if (reportId === null) return notFound();

  const made = await generateReport(
    {
      store,
      bucket: supabaseReportBucket(admin),
      read: supabaseCheckReader(admin),
      home: siteUrl('/'),
    },
    reportId,
  );
  if (made.outcome === 'stored') {
    await agencyCaptureFor(req)('report_generated', site.account_id, {
      kind: request.kind,
      format,
    });
  }
  if (body.kind === 'form') return seeOther('/reports');
  return made.outcome === 'stored'
    ? Response.json({ reportId }, { status: 201 })
    : refuse(500, 'report_failed', { reportId });
}
