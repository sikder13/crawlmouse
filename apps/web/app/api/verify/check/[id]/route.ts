import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkDnsTxtRecord, checkMetaTag } from '@/lib/verification';
import { checkRateLimit } from '@/lib/rate-limit';
import { VERIFY_CHECKS_PER_HOUR } from '@/lib/limits';

const HOUR_MS = 60 * 60 * 1000;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sbUser = await supabaseServer();
  const { data: { user } } = await sbUser.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth required' }, { status: 401 });

  const sb = supabaseAdmin();
  const { data: verification } = await sb
    .from('domain_verifications')
    .select('id, domain, method, verification_token, verified_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!verification) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (verification.verified_at) return NextResponse.json({ verified: true });

  // Throttle only the path that performs the outbound DNS/HTTP request (an amplification/
  // scanning primitive), and only after the not-found / already-verified short-circuits so
  // harmless re-polls don't burn a user's legitimate verification budget.
  const rl = await checkRateLimit(`verify:${user.id}`, VERIFY_CHECKS_PER_HOUR, HOUR_MS);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many verification requests. Try again later.' }, { status: 429 });

  const ok = verification.method === 'dns_txt'
    ? await checkDnsTxtRecord(verification.domain, verification.verification_token)
    : await checkMetaTag(verification.domain, verification.verification_token);

  if (ok) {
    await sb.from('domain_verifications').update({ verified_at: new Date().toISOString() }).eq('id', id);
    return NextResponse.json({ verified: true });
  }
  return NextResponse.json({ verified: false });
}
