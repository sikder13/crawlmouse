import { z } from 'zod';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { ownedAccountId } from '@/lib/billing/owner';
import { getClientIp } from '@/lib/client-ip';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { requestEmailChange } from '@/lib/v2/account/email-change';
import { emailChangePorts } from '@/lib/v2/account/email-change-ports';
import { notFound, readBody, refuse } from '@/lib/v2/account/route';

const Body = z.strictObject({ newEmail: z.string() });

/**
 * Ask to change the sign-in address (D3): the owner only, spec 27. The account is the caller's one
 * owned account (CC-03's `ownedAccountId`, read with the caller's own client), and `member_role`
 * must answer 'owner' for it before the service-role client is made. The answer is the same
 * whether or not the new address is in use: 202 for JSON, a 303 back to the settings page for a
 * form.
 */
export async function POST(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  const body = await readBody(req);
  const input = body && Body.safeParse(body.fields);
  if (!body || !input?.success) return refuse(400, 'invalid');

  const target = await ownedAccountId(sb, user.id);
  if (!target.ok) return refuse(target.status, target.error);
  const { data: role, error } = await sb.rpc('member_role', { p_account: target.accountId });
  if (error) throw new Error(`member_role failed: ${error.message}`);
  if (role !== 'owner') return refuse(403, 'not_owner');

  const outcome = await requestEmailChange(
    emailChangePorts(supabaseAdmin(), req.headers.get('cookie')),
    {
      accountId: target.accountId,
      userId: user.id,
      currentEmail: user.email ?? '',
      newEmail: input.data.newEmail,
      ip: getClientIp(req),
    },
  );
  if (!outcome.ok) return refuse(outcome.status, outcome.code);
  return body.kind === 'form'
    ? new Response(null, { status: 303, headers: { Location: '/settings?email=sent' } })
    : Response.json({ sent: true }, { status: 202 });
}
