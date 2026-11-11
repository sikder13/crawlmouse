import * as Sentry from '@sentry/nextjs';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { COOKIES } from '@/lib/auth/constants';
import { admitSiteHost } from '@/lib/auth/admit-site';
import { pepperFrom } from '@/lib/auth/ledger';
import { requestCookie } from '@/lib/auth/request-cookie';
import { sentryReport, supabaseDoorStore } from '@/lib/auth/stores';
import { billingDispatcher } from '@/lib/billing/effect-sinks';
import { supabaseEntitlementStore } from '@/lib/billing/state-machine-apply';
import { getClientIp } from '@/lib/client-ip';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { captureFor } from '@/lib/v2/account/events';
import { ownedAccount, startProTrial, trialAccountId } from '@/lib/v2/account/pro-trial';
import { notFound, readBody, refuse, refuseTo, respond } from '@/lib/v2/account/route';

/** The page the offer is on, where a form is sent back to when it is refused. */
const BACK = '/dashboard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Start the no-card Pro trial (CC-26b D7): the dashboard's one-time offer. The body names the
 * account (`accountId`), whose owner the caller must be, asked of the caller's own session before
 * the service-role client is made. The decision is the account door's (lib/v2/account/pro-trial.ts).
 * A form is sent to the dashboard on success; JSON gets `{ url }`.
 */
export async function POST(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  const body = await readBody(req);
  if (!body) return refuseTo(req, BACK, 400, 'invalid');
  const accountId = trialAccountId(body.fields);
  if (accountId === null) return notFound();
  const { data: role, error } = await sb.rpc('member_role', { p_account: accountId });
  if (error) throw new Error(`member_role failed: ${error.message}`);
  if (role === null) return notFound();
  if (role !== 'owner') return refuseTo(req, BACK, 403, 'not_owner');
  const account = await ownedAccount(sb, accountId, user.id);
  if (account === null || !user.email) return notFound();

  const admin = supabaseAdmin();
  const answer = await startProTrial(
    {
      store: supabaseDoorStore(admin),
      entitlement: supabaseEntitlementStore(admin),
      admit: (host) => admitSiteHost(host),
      report: sentryReport((m, ctx) => Sentry.captureMessage(m, ctx)),
      pepper: pepperFrom(process.env),
      now: () => new Date(),
      dispatch: billingDispatcher(process.env),
    },
    account,
    {
      accountId,
      userId: user.id,
      email: user.email,
      device: requestCookie(req, COOKIES.device) ?? null,
      ip: getClientIp(req),
    },
  );
  if (answer.outcome !== 'started') return refuseTo(req, BACK, answer.status, answer.code);
  await captureFor(req)('trial_started', accountId, { kind: 'pro', variant: answer.variant });
  return respond(body.kind, '/dashboard');
}
