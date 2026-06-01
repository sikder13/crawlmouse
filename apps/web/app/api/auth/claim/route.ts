import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readAnonSessionId, clearAnonSession } from '@/lib/anon-session';

// Called right after sign-in: reassign audits this browser ran anonymously to the
// now-authenticated user, so "audit anonymously → sign up → keep it" works. The anon
// session id is an httpOnly cookie (an unguessable capability), so a browser can only
// claim its own anonymous audits, and only those still unclaimed (user_id is null).
export async function POST() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const anonId = await readAnonSessionId();
  if (!anonId) return NextResponse.json({ claimed: 0 });

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('audits')
    .update({ user_id: user.id })
    .eq('anonymous_session_id', anonId)
    .is('user_id', null)
    .select('id');
  if (error) return NextResponse.json({ error: 'claim_failed' }, { status: 500 });

  await clearAnonSession();
  return NextResponse.json({ claimed: data?.length ?? 0 });
}
