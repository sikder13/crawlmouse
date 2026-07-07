import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { NOTIFY_PER_IP_PER_DAY, NOTIFY_PER_EMAIL_PER_DAY } from '@/lib/limits';

// SPEC 04 §2 — the email-me-when-done capture. Capability model: possession of the audit UUID
// authorizes the request (anonymous audits included), exactly like the result page itself. The
// stored address is read ONLY by the worker's completion send and is never serialized to any
// client (see the projection chokepoint test). Abuse: per-IP + per-normalized-email daily caps via
// the existing rate_limits pattern; content is neutral and non-customizable (inngest/notify.ts).

const schema = z.object({ email: z.string().trim().email().max(254) });
const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  const email = parsed.data.email.toLowerCase();

  const ip = getClientIp(req);
  if (ip) {
    const rlIp = await checkRateLimit(`notify:ip:${ip}`, NOTIFY_PER_IP_PER_DAY, DAY_MS);
    if (!rlIp.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const rlEmail = await checkRateLimit(`notify:email:${email}`, NOTIFY_PER_EMAIL_PER_DAY, DAY_MS);
  if (!rlEmail.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  // Only a still-running audit accepts a notify request; a finished one has nothing to wait for.
  // The status guard doubles as the capability check: a non-existent id matches 0 rows -> 409.
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('audits')
    .update({ notify_email: email, notify_requested_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['pending', 'crawling'])
    .select('id');
  // Fail-soft (503): the valve is a courtesy — a DB error (e.g. Runbook A not yet applied) must
  // degrade quietly, never break the wait experience.
  if (error) return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  if (!data || data.length === 0) return NextResponse.json({ error: 'audit_finished' }, { status: 409 });

  return NextResponse.json({ ok: true });
}
