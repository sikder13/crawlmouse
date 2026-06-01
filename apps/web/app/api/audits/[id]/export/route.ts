import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isProActive } from '@/lib/pro';
import { buildAuditZip, type FindingExport, type PageExport } from '@/lib/billing/csv';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const { data: me } = await sb.from('users').select('pro_until').eq('id', user.id).maybeSingle();
  if (!isProActive(me?.pro_until ?? null)) return NextResponse.json({ error: 'pro_required' }, { status: 402 });

  const admin = supabaseAdmin();
  const { data: audit } = await admin.from('audits').select('id, user_id').eq('id', id).maybeSingle();
  if (!audit) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (audit.user_id !== user.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { data: pages } = await admin.from('pages').select('id, url, title, status_code, depth, in_degree, out_degree, is_orphan').eq('audit_id', id);
  const { data: findings } = await admin.from('findings').select('category, severity, page_id, payload').eq('audit_id', id);
  const pageUrlById = new Map<string, string>((pages ?? []).map((p) => [p.id, p.url]));

  const findingExports: FindingExport[] = (findings ?? []).map((f) => ({
    category: f.category, severity: f.severity,
    pageUrl: f.page_id ? pageUrlById.get(f.page_id) ?? null : null,
    detail: typeof f.payload === 'object' && f.payload ? JSON.stringify(f.payload) : '',
  }));
  const pageExports: PageExport[] = (pages ?? []).map((p) => ({
    url: p.url, title: p.title, status_code: p.status_code, depth: p.depth, in_degree: p.in_degree, out_degree: p.out_degree, is_orphan: p.is_orphan,
  }));

  const zip = await buildAuditZip(findingExports, pageExports);
  return new Response(new Uint8Array(zip), {
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="crawlmouse-audit-${id}.zip"` },
  });
}
