import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { newReportSlug } from '@/lib/slug';
import { normalizeDomain } from '@/lib/domain';
import { checkRateLimit } from '@/lib/rate-limit';
import { MINT_REPORTS_PER_DAY } from '@/lib/limits';

const schema = z.object({ auditId: z.string().uuid() });
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SLUG_ATTEMPTS = 3;

type SupabaseAdmin = ReturnType<typeof supabaseAdmin>;

/**
 * Insert a public_reports row, tolerating the (astronomically rare) slug PK
 * collision and the much more likely double-submit race on the audit_id UNIQUE
 * constraint. On a unique violation we look up the row already keyed to this audit
 * and return its slug (idempotent); only a genuine slug collision retries.
 */
async function insertReportWithRetry(
  sb: SupabaseAdmin,
  auditId: string,
  domain: string,
): Promise<{ slug: string } | { error: string }> {
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = newReportSlug();
    const { error } = await sb.from('public_reports').insert({ slug, audit_id: auditId, domain });
    if (!error) return { slug };
    if (error.code !== '23505') return { error: 'could not mint' };
    // Unique violation: if it's the audit_id constraint, a report already exists — return it.
    const { data: existing } = await sb.from('public_reports').select('slug').eq('audit_id', auditId).maybeSingle();
    if (existing) return { slug: existing.slug };
    // Otherwise it was a slug PK collision: loop and try a fresh slug.
  }
  return { error: 'could not mint' };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });

  const sbUser = await supabaseServer();
  const { data: { user } } = await sbUser.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth required' }, { status: 401 });

  const rl = await checkRateLimit(`mint:${user.id}`, MINT_REPORTS_PER_DAY, DAY_MS);
  if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const sb = supabaseAdmin();
  const { data: audit } = await sb
    .from('audits')
    .select('id, user_id, url, status')
    .eq('id', parsed.data.auditId)
    .maybeSingle();
  if (!audit || audit.user_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (audit.status !== 'completed') return NextResponse.json({ error: 'audit not complete' }, { status: 400 });

  // One canonical domain key everywhere (verification, public_reports, embed lookups).
  const domain = normalizeDomain(audit.url);

  // Require verified domain ownership.
  const { data: verification } = await sb
    .from('domain_verifications')
    .select('verified_at')
    .eq('user_id', user.id)
    .eq('domain', domain)
    .maybeSingle();
  if (!verification?.verified_at) {
    return NextResponse.json({ error: 'verification_required', domain }, { status: 403 });
  }

  // Already public? (fast path; the retry below also covers the double-submit race)
  const { data: existing } = await sb.from('public_reports').select('slug').eq('audit_id', audit.id).maybeSingle();
  if (existing) return NextResponse.json({ slug: existing.slug });

  const result = await insertReportWithRetry(sb, audit.id, domain);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 });

  // Ensure the owner's embed-badge row exists so the embed view counter has a row
  // to increment. Idempotent on the (user_id, domain) unique constraint.
  await sb.from('embed_badges').upsert({ user_id: user.id, domain }, { onConflict: 'user_id,domain', ignoreDuplicates: true });

  return NextResponse.json({ slug: result.slug });
}
