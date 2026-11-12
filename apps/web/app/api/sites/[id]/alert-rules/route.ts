import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import {
  isId,
  meantMethod,
  notFound,
  readBody,
  refuse,
  refuseTo,
  respond,
} from '@/lib/v2/account/route';
import { readSite } from '@/lib/v2/account/sites';
import { decideSiteAlertRule, setSiteAlertRule } from '@/lib/v2/account/sites-store';
import { readEntitlement } from '@/lib/v2/account/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function PUT(req: Request, ctx: Context) {
  if (!checksPublicEnabled()) return notFound();
  return update(req, ctx, 'PUT');
}

/** A form's PUT, posted with `_method` (`meantMethod`). */
export async function POST(req: Request, ctx: Context) {
  if (!checksPublicEnabled()) return notFound();
  return update(req, ctx, null);
}

/**
 * One site's override of an alert rule (CC-28 D8; spec 27 `alertRules`, the path ACCOUNT_ACTIONS
 * names, owner ruling Q7), for any signed-in member whose seat covers the site. The guards are
 * CC-27b's `PUT /api/alert-rules`: the membership is read through the caller's own session before the
 * service-role client is made, and a site of another account, a removed one or a malformed id is the
 * same 404. Slack needs a paid tier (402). A form goes back to the site page, a refused one with
 * `?notice=<code>`; JSON gets the override's switch and channels.
 */
async function update(req: Request, { params }: Context, method: 'PUT' | null) {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  const { id } = await params;
  if (!isId(id)) return notFound();
  const back = `/sites/${id}`;
  const { data: member, error: memberError } = await sb.rpc('is_member_for_site', { p_site: id });
  if (memberError) throw new Error(`is_member_for_site failed: ${memberError.message}`);
  if (member !== true) return notFound();
  const site = await readSite(sb, id);
  if (site === null || site.removed_at !== null) return notFound();
  const { data: role, error: roleError } = await sb.rpc('member_role', {
    p_account: site.account_id,
  });
  if (roleError) throw new Error(`member_role failed: ${roleError.message}`);
  if (typeof role !== 'string') return notFound();
  const entitlement = await readEntitlement(sb, site.account_id, new Date());
  if (entitlement === null) return notFound();

  const body = await readBody(req);
  if (body === null) return refuseTo(req, back, 400, 'invalid');
  const meant = meantMethod(req, body);
  if ((method ?? meant.method) !== 'PUT') return refuse(405, 'method_not_allowed');
  const decision = decideSiteAlertRule(
    { kind: body.kind, fields: meant.fields },
    entitlement.gates,
  );
  if (!decision.ok) {
    return decision.status === 402
      ? refuseTo(req, back, 402, decision.code, { gate: decision.gate })
      : refuseTo(req, back, 400, decision.code);
  }

  const outcome = await setSiteAlertRule(
    supabaseAdmin(),
    site.account_id,
    id,
    decision.plan,
    entitlement.gates,
  );
  if (!outcome.ok) return notFound();
  return body.kind === 'form' ? respond('form', back) : Response.json({ rule: outcome.rule });
}
