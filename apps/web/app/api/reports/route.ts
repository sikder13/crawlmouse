import { checksPublicEnabled } from '@/lib/auth/flags';
import { seeOther } from '@/lib/billing/request-body';
import { checkRateLimit } from '@/lib/rate-limit';
import { siteUrl } from '@/lib/site-url';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { notFound, noticeTo, paywall, readBody, refuse, refuseTo } from '@/lib/v2/account/route';
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
import { REPORTS_PAGE } from '@/lib/v2/reports/share';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A report is made inside the request (docs/specs/v2/31-agency.md §9 has the measured times).
export const maxDuration = 60;

/**
 * Reports an account may ask for in an hour and in a day, both failing closed. Each report is a file
 * kept in the bucket (nothing expires one: docs/specs/v2/31-agency.md §13), so the day's bound is
 * what holds how fast an account's files grow; a seat of any role spends the account's bounds.
 */
const PER_ACCOUNT_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;
const PER_ACCOUNT_DAY = 100;
const DAY_MS = 24 * HOUR_MS;
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
 * one of the requests; 404 for a site the caller's seat does not cover or a removed one, and for a
 * check (or the fix) that is not a result of that site as the caller's own session reads it; 400
 * `invalid` for a comparison with no earlier check to compare with (the one named is the later
 * check itself, or the fix's check was compared with none); 403 `role_refused` for a role
 * `seat_may` refuses `export_report`; 402 `exports` when the site's account's tier has no exports;
 * 429 `rate_limited` past the account's hourly bound or its daily one, each failing closed. Only
 * then is the service-role client made: 409 `fix_not_verified` for a fix the named check did not
 * verify (404 for a fix of another site); then the row is written (`create_report`, which checks
 * the checks against the site again), the file made and stored, and `report_generated` sent. The
 * answer is 201 `{reportId}` to JSON and a 303 to `/reports` to a form; when the file could not be
 * made the row is left failed, and JSON gets 500 `report_failed` with the row's id.
 *
 * The Reports screen's forms post here. A form refused with either 400, the 402, the 403, the 409
 * or the 429 is sent back to `/reports` with the refusal's notice (`NOTICE_LINES`; for the 429,
 * `reports_capped`); a 401 and a 404 are JSON for a form too (`refuseTo`).
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
  if (body === null || request === null) return refuseTo(req, REPORTS_PAGE, 400, 'invalid');

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
  if (earlierId === null || earlierId === request.checkId) {
    return refuseTo(body.kind, REPORTS_PAGE, 400, 'invalid');
  }
  const earlier = earlierId === undefined ? [] : await readResultChecks(sb, siteId, [earlierId]);
  if (earlier === null) return notFound();

  const { data: allowed, error: guardError } = await sb.rpc('seat_may', {
    p_account: site.account_id,
    p_action: 'export_report',
  });
  if (guardError) throw new Error(`seat_may failed: ${guardError.message}`);
  if (allowed !== true) return refuseTo(body.kind, REPORTS_PAGE, 403, 'role_refused');
  const entitlement = await readEntitlement(sb, site.account_id, new Date());
  if (entitlement === null) return notFound();
  if (!entitlement.gates.exports) {
    return body.kind === 'form' ? noticeTo(REPORTS_PAGE, 'upgrade_required') : paywall('exports');
  }

  // Each bound is its own call, with its window written out: lib/rate-limit-callers.test.ts reads
  // the window of each checkRateLimit call from the source.
  const hour = await checkRateLimit(
    `reports:account:${site.account_id}`,
    PER_ACCOUNT_HOUR,
    HOUR_MS,
    { failClosed: true },
  );
  const limit = hour.allowed
    ? await checkRateLimit(`reports:account-day:${site.account_id}`, PER_ACCOUNT_DAY, DAY_MS, {
        failClosed: true,
      })
    : hour;
  if (!limit.allowed) {
    // A form's line says reports and when the bound that refused it ends; `rate_limited`'s line
    // is the fix mail's.
    if (body.kind === 'form') {
      return noticeTo(REPORTS_PAGE, 'reports_capped', limit.resetAt.toISOString());
    }
    const seconds = Math.max(1, Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000));
    return refuse(429, 'rate_limited', {}, { 'retry-after': String(seconds) });
  }

  const admin = supabaseAdmin();
  if (fixId !== undefined) {
    // A fix's proof is of a fix of this site that the later check verified; the document could
    // not be built for another, so none is asked for: no row is written. A fix and its events are
    // granted to no client role, so these are the service role's reads, of a fix the caller's own
    // session answered for (`is_member_for_fix`, above).
    const { data: fix, error: fixReadError } = await admin
      .from('site_fixes')
      .select('site_id')
      .eq('id', fixId)
      .maybeSingle();
    if (fixReadError) throw new Error(`site_fixes read failed: ${fixReadError.message}`);
    if ((fix as { site_id: string } | null)?.site_id !== siteId) return notFound();
    const { data: verified, error: verifiedError } = await admin
      .from('fix_events')
      .select('id')
      .eq('fix_id', fixId)
      .eq('check_id', request.checkId)
      .eq('kind', 'verified')
      .limit(1);
    if (verifiedError) throw new Error(`fix_events read failed: ${verifiedError.message}`);
    if ((verified ?? []).length === 0) {
      return refuseTo(body.kind, REPORTS_PAGE, 409, 'fix_not_verified');
    }
  }
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
