import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { inngest } from '@/lib/inngest';
import { readAnonSessionId } from '@/lib/anon-session';
import { authorizeCancel } from '@/lib/audit-cancel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = supabaseAdmin();
  const { data: audit } = await admin
    .from('audits')
    .select('id, user_id, anonymous_session_id, status')
    .eq('id', id)
    .maybeSingle<{ id: string; user_id: string | null; anonymous_session_id: string | null; status: string }>();
  if (!audit) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Owner (logged-in) OR the matching anon-session (anonymous) — NOT just anyone with the URL.
  const sbAuth = await supabaseServer();
  const { data: { user } } = await sbAuth.auth.getUser();
  const anonSessionId = await readAnonSessionId();
  const decision = authorizeCancel(audit, { userId: user?.id ?? null, anonSessionId });
  if (!decision.allowed) return NextResponse.json({ error: decision.error }, { status: decision.status });

  // Race-safe: only flip a still-running audit. If the crawl finished between the read above and
  // this write, the conditional matches 0 rows → 409. The persist-results completion write is
  // symmetrically guarded (.eq('status','crawling')), so a cancel and a finish can't clobber.
  const nowIso = new Date().toISOString();
  const { data: updated, error } = await admin
    .from('audits')
    .update({ status: 'canceled', canceled_at: nowIso, completed_at: nowIso })
    .eq('id', id)
    .in('status', ['pending', 'crawling'])
    .select('id');
  if (error) return NextResponse.json({ error: 'cancel_failed' }, { status: 500 });
  if (!updated || updated.length === 0) return NextResponse.json({ error: 'not_cancelable' }, { status: 409 });

  // Stop the in-flight crawl (auditFn.cancelOn matches on data.auditId). Best-effort: the row is
  // already 'canceled' for the UI even if this event send hiccups.
  await inngest.send({ name: 'audit.cancel.requested', data: { auditId: id } });

  return NextResponse.json({ status: 'canceled' });
}
