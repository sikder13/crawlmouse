import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { isId, meantMethod, notFound, readBody, refuse, refuseTo } from '@/lib/v2/account/route';
import { loadViewer } from '@/lib/v2/account/viewer';
import { changeSeat, removeSeat, SEATS_PAGE } from '@/lib/v2/agency/seats';
import { supabaseSeatsStore } from '@/lib/v2/agency/seats-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Change a seat's role and the clients it covers: `{role, scope}` (CC-31 D3). */
export async function PATCH(req: Request, ctx: Context) {
  if (!checksPublicEnabled()) return notFound();
  return act(req, ctx, 'PATCH');
}

/** Remove a seat: the person's access to the account ends (CC-31 D3). */
export async function DELETE(req: Request, ctx: Context) {
  if (!checksPublicEnabled()) return notFound();
  return act(req, ctx, 'DELETE');
}

/** A form's PATCH or DELETE, posted with `_method` (`meantMethod`). */
export async function POST(req: Request, ctx: Context) {
  if (!checksPublicEnabled()) return notFound();
  return act(req, ctx, null);
}

/**
 * Both changes, on a seat of the account the caller acts in, for a role `seat_may` allows the change
 * (the owner: docs/specs/v2/31-agency.md §3), asked through the caller's own session before the
 * service-role client is made. The seat is looked up with that account's id, so a seat of another
 * account, a malformed id and a removed seat are the same 404.
 *
 * The path is `/api/seats/id/<id>`: a seat's id directly under `/api/seats` would also match
 * `/api/seats/accept`, and the route registry holds each path to one row.
 */
async function act(req: Request, { params }: Context, method: 'PATCH' | 'DELETE' | null) {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  const { id } = await params;
  if (!isId(id)) return notFound();
  const viewer = await loadViewer();
  if (viewer.kind === 'signed_out') return refuse(401, 'auth_required');
  if (viewer.kind !== 'viewer') return notFound();
  const accountId = viewer.viewer.account.id;

  const body = await readBody(req);
  const meant = body === null ? null : meantMethod(req, body);
  const verb = method ?? meant?.method;
  if (verb !== 'PATCH' && verb !== 'DELETE') return refuse(405, 'method_not_allowed');
  const { data: allowed, error } = await sb.rpc('seat_may', {
    p_account: accountId,
    p_action: verb === 'DELETE' ? 'remove_seat' : 'change_seat',
  });
  if (error) throw new Error(`seat_may failed: ${error.message}`);
  if (allowed !== true) return refuseTo(req, SEATS_PAGE, 403, 'role_refused');

  const store = supabaseSeatsStore(supabaseAdmin());
  const kind = body?.kind ?? 'json';
  if (verb === 'DELETE') return removeSeat({ store, now: () => new Date() }, accountId, id, kind);
  if (meant === null) return refuseTo(req, SEATS_PAGE, 400, 'invalid');
  return changeSeat({ store }, accountId, id, kind, meant.fields);
}
