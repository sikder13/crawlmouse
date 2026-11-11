import { checksPublicEnabled } from '@/lib/auth/flags';
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

/**
 * The account's alert rules and Slack destination (CC-27b D7, spec 27 `accountAlertRules`), for any
 * signed-in member of the account the caller acts in: one account-level rule's switch, and setting,
 * replacing or clearing the Slack webhook URL (a paid tier to set one: 402). The membership is read
 * through the caller's own session (`member_role`) before the service-role client is made, and the
 * writes name that account only, so another account's rule is a 404. The answer carries whether a
 * URL is set and its last four characters, never the URL; a form is sent back to Alerts.
 */
async function update(req: Request, method: 'PUT' | null): Promise<Response> {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  const viewer = await loadViewer();
  if (viewer.kind === 'signed_out') return refuse(401, 'auth_required');
  if (viewer.kind === 'no_account') return refuse(409, 'no_account');
  if (viewer.kind === 'ambiguous') return refuse(409, 'account_ambiguous');
  const { account, gates } = viewer.viewer;

  const { data: role, error: roleError } = await sb.rpc('member_role', { p_account: account.id });
  if (roleError) throw new Error(`member_role failed: ${roleError.message}`);
  if (typeof role !== 'string') return notFound();

  const body = await readBody(req);
  if (body === null) return refuse(400, 'invalid');
  const meant = meantMethod(req, body);
  if ((method ?? meant.method) !== 'PUT') return refuse(405, 'method_not_allowed');
  const decision = decideAlertRules({ kind: body.kind, fields: meant.fields }, gates);
  if (!decision.ok) {
    return decision.status === 402
      ? refuse(402, decision.code, { gate: decision.gate })
      : refuse(400, decision.code);
  }

  const outcome = await applyAlertRules(
    supabaseAlertRulePorts(supabaseAdmin()),
    account.id,
    decision.plan,
  );
  if (!outcome.ok) return notFound();
  return body.kind === 'form' ? respond('form', BACK) : Response.json({ slack: outcome.slack });
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
