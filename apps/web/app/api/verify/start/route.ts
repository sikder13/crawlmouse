import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { newVerificationToken } from '@/lib/slug';

const schema = z.object({ domain: z.string().min(3), method: z.enum(['dns_txt', 'meta_tag']) });

export async function POST(req: Request) {
  const sbUser = await supabaseServer();
  const { data: { user } } = await sbUser.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth required' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });

  let domain: string;
  try {
    const u = new URL(parsed.data.domain.startsWith('http') ? parsed.data.domain : `https://${parsed.data.domain}`);
    domain = u.hostname.replace(/^www\./, '');
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
