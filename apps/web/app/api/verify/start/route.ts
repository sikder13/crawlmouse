import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { newVerificationToken } from '@/lib/slug';
import { normalizeDomain } from '@/lib/domain';
import { checkRateLimit } from '@/lib/rate-limit';
import { VERIFY_CHECKS_PER_HOUR } from '@/lib/limits';

const schema = z.object({ domain: z.string().min(3), method: z.enum(['dns_txt', 'meta_tag']) });
const HOUR_MS = 60 * 60 * 1000;

export async function POST(req: Request) {
  const sbUser = await supabaseServer();
  const { data: { user } } = await sbUser.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth required' }, { status: 401 });

  const rl = await checkRateLimit(`verify:${user.id}`, VERIFY_CHECKS_PER_HOUR, HOUR_MS);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many verification requests. Try again later.' }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });

  let domain: string;
  try {
    domain = normalizeDomain(parsed.data.domain);
  } catch {
    return NextResponse.json({ error: 'invalid domain' }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: existing } = await sb
    .from('domain_verifications')
    .select('id, verification_token, verified_at')
    .eq('user_id', user.id)
    .eq('domain', domain)
    .maybeSingle();

  if (existing?.verified_at) {
    return NextResponse.json({ id: existing.id, token: existing.verification_token, verified: true });
  }

  const token = existing?.verification_token ?? newVerificationToken();
  const { data: row, error } = await sb
    .from('domain_verifications')
    .upsert({
      id: existing?.id,
      user_id: user.id,
      domain,
      method: parsed.data.method,
      verification_token: token,
    }, { onConflict: 'user_id,domain' })
    .select('id')
    .single();

  if (error || !row) return NextResponse.json({ error: 'could not create' }, { status: 500 });
  return NextResponse.json({ id: row.id, token, verified: false });
}
