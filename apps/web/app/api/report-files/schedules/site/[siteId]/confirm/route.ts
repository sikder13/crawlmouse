import { checksPublicEnabled } from '@/lib/auth/flags';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { isId, notFound, readBody, refuse, refuseTo } from '@/lib/v2/account/route';
import { CLIENT_REPORTS_PAGE, resendConfirmation } from '@/lib/v2/agency/schedules';
import { clientReportsGate, clientSiteOf } from '@/lib/v2/agency/schedules-caller';
import { inngestClientReportMail, supabaseSchedulesStore } from '@/lib/v2/agency/schedules-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ siteId: string }> };

/** Confirmation mails an account may ask for in a day; it fails closed. */
const PER_ACCOUNT_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ask for the confirmation mail of a client's schedule again (CC-31 D8): the contact has not
 * confirmed, and no report is sent until they do.
 *
 * For a seat that covers the site (`is_member_for_site`: any other site is a 404) and whose role
 * `seat_may` lets schedule reports (the owner or an account manager: docs/specs/v2/31-agency.md §3;
 * a developer is 403), both asked through the caller's own session before the service-role client is
 * made. Client reports are Agency's: any other plan is 402 with the gate's name.
 * The account's daily bound on confirmation mail applies.
 */
export async function POST(req: Request, { params }: Context) {
  if (!checksPublicEnabled()) return notFound();
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  const { siteId } = await params;
  if (!isId(siteId)) return notFound();
  const { data: member, error: memberError } = await sb.rpc('is_member_for_site', {
    p_site: siteId,
  });
  if (memberError) throw new Error(`is_member_for_site failed: ${memberError.message}`);
  if (member !== true) return notFound();
  const site = await clientSiteOf(sb, siteId);
  if (site === null) return notFound();
  const { data: allowed, error: guardError } = await sb.rpc('seat_may', {
    p_account: site.accountId,
    p_action: 'schedule_report',
  });
  if (guardError) throw new Error(`seat_may failed: ${guardError.message}`);
  if (allowed !== true) return refuseTo(req, CLIENT_REPORTS_PAGE, 403, 'role_refused');

  const body = await readBody(req);
  const kind = body?.kind ?? 'json';
  const gated = await clientReportsGate(sb, site.accountId, kind, new Date());
  if (gated) return gated;

  return resendConfirmation(
    {
      store: supabaseSchedulesStore(supabaseAdmin()),
      mail: inngestClientReportMail(),
      confirmations: () =>
        checkRateLimit(`report-confirm:account:${site.accountId}`, PER_ACCOUNT_DAY, DAY_MS, {
          failClosed: true,
        }),
      now: () => new Date(),
    },
    site,
    kind,
  );
}
