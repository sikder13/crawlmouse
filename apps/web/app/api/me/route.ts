import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { meantMethod, notFound, readBody, refuse, refuseTo, respond } from '@/lib/v2/account/route';
import { saveTheme, ThemeBody } from '@/lib/v2/account/theme';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The signed-in person's own settings (CC-26b D10): `{theme}` and nothing else, written to their own
 * active seats. PATCH, or a form's POST naming PATCH in `_method` (the theme control posts that way
 * where script does not run). A form goes back to the dashboard; JSON gets the theme saved.
 */
async function update(req: Request): Promise<Response> {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  const body = await readBody(req);
  if (!body) return refuseTo(req, '/dashboard', 400, 'invalid');
  const { method, fields } = meantMethod(req, body);
  if (method !== 'PATCH') return refuse(405, 'method_not_allowed');
  const parsed = ThemeBody.safeParse(fields);
  if (!parsed.success) return refuseTo(req, '/dashboard', 400, 'invalid');

  await saveTheme(supabaseAdmin(), user.id, parsed.data.theme);
  return body.kind === 'form'
    ? respond('form', '/dashboard')
    : Response.json({ theme: parsed.data.theme });
}

export async function PATCH(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  return update(req);
}

export async function POST(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  return update(req);
}
