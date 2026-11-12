import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { userIsPro } from '@/lib/pro';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Lightweight poll target for the post-checkout "Activating Pro…" card: returns just the
// entitlement bit (own row, RLS-scoped) so the client isn't refetching the whole dashboard
// while it waits for the webhook to land.
export async function GET() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ pro: false }, { status: 401 });
  return NextResponse.json({ pro: await userIsPro(sb, user.id) });
}
