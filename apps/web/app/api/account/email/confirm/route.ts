import { z } from 'zod';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { resolveOrigin } from '@/lib/origin';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { confirmEmailChange } from '@/lib/v2/account/email-change';
import { linkAnswer } from '@/lib/v2/account/email-change-answer';
import { emailChangePorts } from '@/lib/v2/account/email-change-ports';
import { linkToken } from '@/lib/v2/account/link-cookie';
import { notFound, readBody, refuse } from '@/lib/v2/account/route';

/** The page's form posts no field: the token is read from the cookie, never from the body. */
const Body = z.strictObject({});

/**
 * Confirm an email change from the page the confirmation link landed on (D3). The token in the
 * `cm_link_email` cookie is the credential, so the browser need not be signed in; when it is signed
 * in as the person, its own session is the one kept. POST only: a GET here is answered 405 by Next,
 * so a link scanner cannot confirm.
 */
export async function POST(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  const body = await readBody(req);
  if (!body || !Body.safeParse(body.fields).success) return refuse(400, 'invalid');
  const origin = resolveOrigin(req);
  const cookie = req.headers.get('cookie');
  const token = linkToken(cookie, 'emailChange');
  if (token === null) {
    return linkAnswer(
      body.kind,
      origin,
      'emailChange',
      { ok: false, status: 410, code: 'link_unusable' },
      false,
    );
  }

  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const claims = user ? (await sb.auth.getClaims()).data?.claims : undefined;
  const caller =
    user && claims?.sub === user.id && typeof claims.session_id === 'string'
      ? { userId: user.id, sessionId: claims.session_id }
      : null;

  const outcome = await confirmEmailChange(emailChangePorts(supabaseAdmin(), cookie), {
    token,
    caller,
  });
  return linkAnswer(body.kind, origin, 'emailChange', outcome, true);
}
