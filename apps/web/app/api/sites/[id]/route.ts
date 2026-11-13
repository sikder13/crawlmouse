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
import { decideEdit, isRemoveConfirmed, parseEditBody, readSite } from '@/lib/v2/account/sites';
import { editSite, removeSite } from '@/lib/v2/account/sites-store';
import { readEntitlement } from '@/lib/v2/account/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Edit a site: its schedule, competitors and staging URL (CC-26b D6). */
export async function PATCH(req: Request, ctx: Context) {
  if (!checksPublicEnabled()) return notFound();
  return change(req, ctx, 'PATCH');
}

/**
 * Remove a site: `removed_at` is set and its history kept (CC-26b D6). The body must be
 * `{confirm: 'remove'}` (a form's ticked box); anything else is 400 `confirm_required`.
 */
export async function DELETE(req: Request, ctx: Context) {
  if (!checksPublicEnabled()) return notFound();
  return change(req, ctx, 'DELETE');
}

/** A form's PATCH or DELETE, posted with `_method` (`meantMethod`). */
export async function POST(req: Request, ctx: Context) {
  if (!checksPublicEnabled()) return notFound();
  return change(req, ctx, null);
}

/**
 * Both changes, for a seat that covers the site and whose role `seat_may` allows the change (the owner
 * or an account manager: docs/specs/v2/31-agency.md §3).
 * A site of another account, a malformed id and a removed site are the same 404, decided through the
 * caller's own session before the service-role client is made. What an edit may set is decided with
 * the gates and limits of the site's own account. A form is answered with a 303 (to the site after an
 * edit, to the dashboard after a removal), JSON with JSON.
 */
async function change(req: Request, { params }: Context, method: 'PATCH' | 'DELETE' | null) {
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
  const body = await readBody(req);
  const meant = body === null ? null : meantMethod(req, body);
  const verb = method ?? meant?.method;
  const { data: allowed, error: guardError } = await sb.rpc('seat_may', {
    p_account: site.account_id,
    p_action: verb === 'DELETE' ? 'remove_site' : 'edit_site',
  });
  if (guardError) throw new Error(`seat_may failed: ${guardError.message}`);
  if (allowed !== true) return refuseTo(req, back, 403, 'role_refused');
  const entitlement = await readEntitlement(sb, site.account_id, new Date());
  if (entitlement === null) return notFound();

  if (verb === 'DELETE') {
    if (!isRemoveConfirmed(meant?.fields ?? {})) {
      return refuseTo(req, back, 400, 'confirm_required');
    }
    const removed = await removeSite(supabaseAdmin(), id);
    if (removed.outcome === 'already_removed') return notFound();
    return body?.kind === 'form' ? respond('form', '/dashboard') : Response.json({ removed: true });
  }
  if (verb !== 'PATCH') return refuse(405, 'method_not_allowed');
  if (body === null || meant === null) return refuseTo(req, back, 400, 'invalid');

  const edit = parseEditBody(meant.fields);
  if (edit === null) return refuseTo(req, back, 400, 'invalid');
  const decision = await decideEdit(
    edit,
    { host: site.host, isStaging: site.staging_of_site_id !== null },
    entitlement,
  );
  if (!decision.ok) {
    if (decision.status === 402)
      return refuseTo(req, back, 402, decision.code, { gate: decision.gate });
    if (decision.status === 409) return refuseTo(req, back, 409, decision.code);
    return refuseTo(req, back, decision.status, decision.code, { field: decision.field });
  }
  const edited = await editSite(supabaseAdmin(), id, decision.patch);
  switch (edited.outcome) {
    case 'updated':
      return body.kind === 'form'
        ? respond('form', `/sites/${id}`)
        : Response.json({ stagingSiteId: edited.stagingSiteId });
    case 'removed':
      return notFound();
    case 'is_staging':
      return refuseTo(req, back, 409, 'staging_site');
    case 'exists':
      return refuseTo(req, back, 409, 'site_exists', { field: 'stagingUrl' });
  }
}
