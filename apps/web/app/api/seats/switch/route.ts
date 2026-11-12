import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseServer } from '@/lib/supabase/server';
import { isId, notFound, readBody, refuse } from '@/lib/v2/account/route';
import { accountCookie } from '@/lib/v2/account/viewer-cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `accountCookie`'s fields as a `Set-Cookie` value. */
function setCookie(c: ReturnType<typeof accountCookie>): string {
  const attributes = [
    `Path=${c.path}`,
    `Max-Age=${c.maxAge}`,
    'HttpOnly',
    `SameSite=${c.sameSite}`,
  ];
  if (c.secure) attributes.push('Secure');
  return [`${c.name}=${c.value}`, ...attributes].join('; ');
}

/**
 * Choose the account to act in (CC-31 D2b): `{accountId}`. A 404 with V2_CHECKS_PUBLIC unset, and
 * for an account the caller holds no active seat on (`is_member`, asked as the caller, which is
 * false for a removed seat, an invitation not accepted and an account marked for deletion). The
 * choice is recorded in the switcher's cookie and nowhere else. A form is answered with a 303 to
 * the client matrix for an agency account and to the dashboard for a personal one; JSON with the
 * account's id.
 */
export async function POST(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  const body = await readBody(req);
  const accountId = body?.fields.accountId;
  if (!body || typeof accountId !== 'string' || Object.keys(body.fields).length !== 1) {
    return refuse(400, 'invalid');
  }
  if (!isId(accountId)) return notFound();

  const { data: member, error: memberError } = await sb.rpc('is_member', { p_account: accountId });
  if (memberError) throw new Error(`is_member failed: ${memberError.message}`);
  if (member !== true) return notFound();
  const account = await sb.from('accounts').select('kind').eq('id', accountId).maybeSingle();
  if (account.error) throw new Error(`accounts read failed: ${account.error.message}`);
  const kind = (account.data as { kind: string } | null)?.kind;
  if (kind === undefined) return notFound();

  const secure = new URL(req.url).protocol === 'https:';
  const headers = { 'set-cookie': setCookie(accountCookie(accountId, secure)) };
  return body.kind === 'form'
    ? new Response(null, {
        status: 303,
        headers: { ...headers, location: kind === 'agency' ? '/agency' : '/dashboard' },
      })
    : Response.json({ accountId }, { headers });
}
