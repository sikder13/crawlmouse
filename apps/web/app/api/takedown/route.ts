import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';

const schema = z.object({
  publicReportSlug: z.string().optional(),
  domain: z.string().min(3),
  requesterEmail: z.string().email(),
  reason: z.string().min(10),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });

  const sb = supabaseAdmin();
  const { error } = await sb.from('takedown_requests').insert({
    public_report_slug: parsed.data.publicReportSlug ?? null,
    domain: parsed.data.domain,
    requester_email: parsed.data.requesterEmail,
    reason: parsed.data.reason,
    status: 'pending',
  });
  if (error) return NextResponse.json({ error: 'could not submit' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
