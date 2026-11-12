import { z } from 'zod';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { resolveOrigin } from '@/lib/origin';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { undoEmailChange } from '@/lib/v2/account/email-change';
import { linkAnswer } from '@/lib/v2/account/email-change-answer';
import { emailChangePorts } from '@/lib/v2/account/email-change-ports';
import { linkToken } from '@/lib/v2/account/link-cookie';
import { notFound, readBody, refuse } from '@/lib/v2/account/route';

/** The page's form posts no field: the token is read from the cookie, never from the body. */
const Body = z.strictObject({});

/**
 * Undo an email change from the page the "this wasn't me" link landed on (D3, Q8). The token in the
 * `cm_link_email_undo` cookie is the credential: the person may have no session left. POST only; a
 * GET is answered 405 by Next.
 */
export async function POST(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  const body = await readBody(req);
  if (!body || !Body.safeParse(body.fields).success) return refuse(400, 'invalid');
  const origin = resolveOrigin(req);
  const cookie = req.headers.get('cookie');
  const token = linkToken(cookie, 'emailUndo');
  if (token === null) {
    return linkAnswer(
      body.kind,
      origin,
      'emailUndo',
      { ok: false, status: 410, code: 'link_unusable' },
      false,
    );
  }
  const outcome = await undoEmailChange(emailChangePorts(supabaseAdmin(), cookie), { token });
  return linkAnswer(body.kind, origin, 'emailUndo', outcome, true);
}
