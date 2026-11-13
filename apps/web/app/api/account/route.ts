import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { getClientIp } from '@/lib/client-ip';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { requestAccountDeletion } from '@/lib/v2/account/deletion';
import { routeDeletionPorts } from '@/lib/v2/account/deletion-ports';
import { requestEmailChange } from '@/lib/v2/account/email-change';
import { emailChangePorts } from '@/lib/v2/account/email-change-ports';
import { supabaseProfilePorts, updateProfile, type SeatRole } from '@/lib/v2/account/profile';
import { meantMethod, notFound, readBody, refuse, respond } from '@/lib/v2/account/route';
import { loadViewer } from '@/lib/v2/account/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SETTINGS = '/settings';
const DeleteBody = z.strictObject({ hostname: z.string().max(254) });

/** The client's address for the rate limit, or null when the request does not carry one. */
const clientIp = (req: Request): string | null => {
  const ip = getClientIp(req);
  return ip === 'unknown' ? null : ip;
};

/** The account's address: its owner's `users.email`, which Settings posts back as `newEmail`. */
async function ownerEmail(admin: SupabaseClient, accountId: string): Promise<string> {
  const { data, error } = await admin
    .from('seats')
    .select('users!inner(email)')
    .eq('account_id', accountId)
    .eq('role', 'owner')
    .eq('status', 'active')
    .single();
  if (error) throw new Error(`owner email read failed: ${error.message}`);
  return (data as unknown as { users: { email: string } }).users.email;
}

/**
 * The account the signed-in caller acts in (spec 27 `account` and `deleteAccount`):
 *
 * - PATCH saves `{name, timezone, email_prefs}` for the owner or an account manager. A changed
 *   `newEmail` is not saved: from the owner it starts the email change's confirmation (D3), from
 *   anyone else it is refused with 403 and nothing in the request is saved.
 * - DELETE, the owner only, with `hostname` re-typed: deletes nothing, and emails a confirmation link
 *   to the sign-in address (D4).
 *
 * A person's sign-in address and their deletion belong to their own personal account: acting in
 * another account (the switcher, CC-31 D2b), both are refused with 409 `personal_account_only`.
 *
 * The caller's role in the account is read through the caller's own session (`member_role`) before
 * the service-role client is made; a caller with no seat there answers 404. Each write names the
 * caller's account only. A form posts either verb as POST with `_method`.
 */
async function handle(req: Request, verb: 'PATCH' | 'DELETE' | null): Promise<Response> {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  const body = await readBody(req);
  if (body === null) return refuse(400, 'invalid');
  const meant = meantMethod(req, body);
  const method = verb ?? meant.method;
  if (method !== 'PATCH' && method !== 'DELETE') return refuse(405, 'method_not_allowed');
  // A form is sent back to the page it came from, with the refusal's code to show; JSON gets JSON.
  const page = method === 'DELETE' ? `${SETTINGS}/delete` : SETTINGS;
  const no = (status: number, code: string): Response =>
    body.kind === 'form'
      ? respond('form', `${page}?error=${encodeURIComponent(code)}`)
      : refuse(status, code);

  const viewer = await loadViewer();
  if (viewer.kind === 'signed_out') return no(401, 'auth_required');
  if (viewer.kind === 'no_account') return no(409, 'no_account');
  if (viewer.kind === 'ambiguous') return no(409, 'account_ambiguous');
  const accountId = viewer.viewer.account.id;
  const personal = viewer.viewer.account.kind === 'personal';

  const { data: role, error: roleError } = await sb.rpc('member_role', { p_account: accountId });
  if (roleError) throw new Error(`member_role failed: ${roleError.message}`);
  if (typeof role !== 'string') return notFound();

  const admin = supabaseAdmin();
  if (method === 'DELETE') {
    if (role !== 'owner') return no(403, 'not_owner');
    if (!personal) return no(409, 'personal_account_only');
    const input = DeleteBody.safeParse(meant.fields);
    if (!input.success) return no(400, 'invalid');
    const answer = await requestAccountDeletion(
      routeDeletionPorts(admin, req.headers.get('cookie')),
      { userId: user.id, accountId, hostname: input.data.hostname, ip: clientIp(req) },
    );
    if (!answer.ok) return no(answer.status, answer.code);
    return body.kind === 'form'
      ? respond('form', `${SETTINGS}/delete?sent=1`)
      : Response.json({ sent: true }, { status: 202 });
  }

  // The profile's write waits until the email change, if any, is accepted, so a refused change
  // (rate limited, in flight) saves nothing in the request.
  const pending: { accountId: string; columns: Readonly<Record<string, unknown>> }[] = [];
  const outcome = await updateProfile(
    { updateAccount: async (id, columns) => void pending.push({ accountId: id, columns }) },
    {
      accountId,
      accountEmail: await ownerEmail(admin, accountId),
      role: role as SeatRole,
      body: { kind: body.kind, fields: meant.fields },
    },
  );
  if (!outcome.ok) return no(outcome.status, outcome.code);
  if (outcome.forwardEmailChange !== null) {
    if (!personal) return no(409, 'personal_account_only');
    const change = await requestEmailChange(emailChangePorts(admin, req.headers.get('cookie')), {
      accountId,
      userId: user.id,
      currentEmail: user.email ?? '',
      newEmail: outcome.forwardEmailChange,
      ip: getClientIp(req),
    });
    if (!change.ok) return no(change.status, change.code);
  }
  const write = supabaseProfilePorts(admin);
  for (const p of pending) await write.updateAccount(p.accountId, p.columns);
  const sent = outcome.forwardEmailChange !== null;
  return body.kind === 'form'
    ? respond('form', sent ? `${SETTINGS}?email=sent` : `${SETTINGS}?saved=1`)
    : Response.json({ saved: outcome.saved, emailChange: sent ? 'sent' : null });
}

export async function PATCH(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  return handle(req, 'PATCH');
}

export async function DELETE(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  return handle(req, 'DELETE');
}

/** A form's PATCH or DELETE, posted with `_method` (`meantMethod`). */
export async function POST(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  return handle(req, null);
}
