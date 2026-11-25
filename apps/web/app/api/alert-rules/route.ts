import { checksPublicEnabled } from '@/lib/auth/flags';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import {
  applyAlertRules,
  decideAlertRules,
  supabaseAlertRulePorts,
} from '@/lib/v2/account/alert-rules';
import { meantMethod, notFound, readBody, refuse, respond } from '@/lib/v2/account/route';
import { loadViewer } from '@/lib/v2/account/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The page the Alerts screen's forms post from. */
const BACK = '/alerts';
/** Test messages an account may send in a day. */
const TESTS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The page the Slack form posts from. */
const INTEGRATIONS = '/settings/integrations';

/** Where a form returns: Integrations when `Referer` is that page on this origin, or Alerts. */
function backOf(req: Request): string {
  const referer = req.headers.get('referer');
  if (!referer) return BACK;
  try {
    const from = new URL(referer);
    return from.origin === new URL(req.url).origin && from.pathname === INTEGRATIONS
      ? INTEGRATIONS
      : BACK;
  } catch {
    return BACK;
  }
}

/**
 * The account's alert rules and Slack destination (CC-27b D7, spec 27 `accountAlertRules`), for a
 * member of the account the caller acts in whose role `seat_may` lets edit them (spec 31 §3): one
 * account-level rule's switch, and setting, replacing or clearing the Slack webhook URL (a paid tier
 * to set one: 402). Membership and role are read through the caller's own session (`member_role`,
 * `seat_may`) before the service-role client is made, and the writes name that account only, so
 * another account's rule is a 404. The answer carries whether a
 * URL is set and its last four characters, never the URL. `{ testSlack: true }` posts the fixed test
 * message, at most ten a day per account, failing closed (429 `rate_limited`): 409
 * `slack_not_connected` with none set, 502 `slack_failed` when Slack refused it, 503
 * `slack_unreachable` when Slack could not be reached. A form is sent back to the page it came from
 * (`backOf`), a refused one with `?error=<code>`, and from Integrations one saved with `?saved=1`, a
 * test sent with `?tested=1`.
 */
async function update(req: Request, method: 'PUT' | null): Promise<Response> {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  const body = await readBody(req);
  if (body === null) return refuse(400, 'invalid');
  // A form is sent back with the refusal's code to show; JSON gets JSON.
  const back = backOf(req);
  const no = (status: number, code: string, detail: Record<string, unknown> = {}): Response =>
    body.kind === 'form'
      ? respond('form', `${back}?error=${encodeURIComponent(code)}`)
      : refuse(status, code, detail);

  const viewer = await loadViewer();
  if (viewer.kind === 'signed_out') return no(401, 'auth_required');
  if (viewer.kind === 'no_account') return no(409, 'no_account');
  if (viewer.kind === 'ambiguous') return no(409, 'account_ambiguous');
  const { account, gates } = viewer.viewer;

  const { data: role, error: roleError } = await sb.rpc('member_role', { p_account: account.id });
  if (roleError) throw new Error(`member_role failed: ${roleError.message}`);
  if (typeof role !== 'string') return no(404, 'not_found');
  const { data: allowed, error: guardError } = await sb.rpc('seat_may', {
    p_account: account.id,
    p_action: 'edit_account_alerts',
  });
  if (guardError) throw new Error(`seat_may failed: ${guardError.message}`);
  if (allowed !== true) return no(403, 'role_refused');

  const meant = meantMethod(req, body);
  if ((method ?? meant.method) !== 'PUT') return no(405, 'method_not_allowed');
  const decision = decideAlertRules({ kind: body.kind, fields: meant.fields }, gates);
  if (!decision.ok) {
    return decision.status === 402
      ? no(402, decision.code, { gate: decision.gate })
      : no(400, decision.code);
  }

  // A test posts to Slack, so it is bounded per account, failing closed.
  if (decision.plan.slack === 'test') {
    const limit = await checkRateLimit(`slack-test:account:${account.id}`, TESTS_PER_DAY, DAY_MS, {
      failClosed: true,
    });
    if (!limit.allowed) return no(429, 'rate_limited');
  }
  const outcome = await applyAlertRules(
    supabaseAlertRulePorts(supabaseAdmin()),
    account.id,
    decision.plan,
  );
  if (!outcome.ok) return no(outcome.status, outcome.code);
  if (body.kind !== 'form') return Response.json({ slack: outcome.slack, tested: outcome.tested });
  if (back !== INTEGRATIONS) return respond('form', back);
  return respond('form', `${INTEGRATIONS}?${outcome.tested ? 'tested' : 'saved'}=1`);
}

export async function PUT(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  return update(req, 'PUT');
}

/** A form's PUT, posted with `_method` (`meantMethod`). */
export async function POST(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  return update(req, null);
}
