import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { accountDoorEnabled } from '@/lib/auth/flags';
import { claimCheck } from '@/lib/auth/claim';
import { isUuid } from '@/lib/auth/continue-intent';
import { doorDeps } from '@/lib/auth/door-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Claim an anonymous check for the signed-in caller's account (CC-25 D8, ARCH-2 §4.3). The same
 * `claimCheck` the sign-in landing runs for a Keep. Members only, from our own pages: a 404 with
 * V2_ACCOUNT_DOOR unset, a 403 for a cross-site post, a 401 without a session. The id is a
 * capability, so an unknown id and another account's check are both 404s.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!accountDoorEnabled()) return NextResponse.json({ code: 'not_found' }, { status: 404 });
  const origin = req.headers.get('origin');
  if (origin !== null && origin !== new URL(req.url).origin) {
    return NextResponse.json({ code: 'cross_site' }, { status: 403 });
  }
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ code: 'auth_required' }, { status: 401 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ code: 'not_found' }, { status: 404 });

  const result = await claimCheck(doorDeps().claim, { checkId: id, userId: user.id });
  if (result.ok) return NextResponse.json({ siteId: result.siteId });
  return NextResponse.json({ code: result.code }, { status: result.status });
}
