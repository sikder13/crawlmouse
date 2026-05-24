import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { newReportSlug } from '@/lib/slug';

const schema = z.object({ auditId: z.string().uuid() });

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });

  const sbUser = await supabaseServer();
  const { data: { user } } = await sbUser.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth required' }, { status: 401 });

  const sb = supabaseAdmin();
  const { data: audit } = await sb
    .from('audits')
    .select('id, user_id, url, status')
    .eq('id', parsed.data.auditId)
    .maybeSingle();
  if (!audit || audit.user_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (audit.status !== 'completed') return NextResponse.json({ error: 'audit not complete' }, { status: 400 });

  const domain = new URL(audit.url).hostname.replace(/^www\./, '');

  // Require verified domain
  const { data: verification } = await sb
    .from('domain_verifications')
    .select('verified_at')
    .eq('user_id', user.id)
    .eq('domain', domain)
    .maybeSingle();
  if (!verification?.verified_at) {
    return NextResponse.json({ error: 'verification_required', domain }, { status: 403 });
  }

  // Already public?
  const { data: existing } = await sb.from('public_reports').select('slug').eq('audit_id', audit.id).maybeSingle();
  if (existing) return NextResponse.json({ slug: existing.slug });

  const slug = newReportSlug();
  const { error } = await sb.from('public_reports').insert({ slug, audit_id: audit.id, domain });
  if (error) return NextResponse.json({ error: 'could not mint' }, { status: 500 });

  return NextResponse.json({ slug });
}
