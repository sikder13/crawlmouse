import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isProActive } from '@/lib/pro';
import { buildAuditZip, type FindingExport, type PageExport } from '@/lib/billing/csv';

export const runtime = 'nodejs';

const PAGE = 1000;
const MAX_DETAIL = 4000;

// PostgREST caps a query at ~1000 rows, so a 2,000-page Pro audit would silently export only half.
// Fetch every row by paging with .range().
async function fetchAll<T>(sb: SupabaseClient, table: string, columns: string, auditId: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select(columns).eq('audit_id', auditId).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}

interface PageRow { id: string; url: string; title: string | null; status_code: number; depth: number | null; in_degree: number; out_degree: number; is_orphan: boolean }
interface FindingRowDb { category: string; severity: string; page_id: string | null; payload: unknown }

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const { data: me } = await sb.from('users').select('pro_until').eq('id', user.id).maybeSingle();
  if (!isProActive(me?.pro_until ?? null)) return NextResponse.json({ error: 'pro_required' }, { status: 402 });

  const admin = supabaseAdmin();
  const { data: audit } = await admin.from('audits').select('id, user_id').eq('id', id).maybeSingle();
  // Same response for missing OR not-owned — don't leak which audit ids exist to other users.
  if (!audit || audit.user_id !== user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const pages = await fetchAll<PageRow>(admin, 'pages', 'id, url, title, status_code, depth, in_degree, out_degree, is_orphan', id);
  const findings = await fetchAll<FindingRowDb>(admin, 'findings', 'category, severity, page_id, payload', id);
  const pageUrlById = new Map<string, string>(pages.map((p) => [p.id, p.url]));

  const findingExports: FindingExport[] = findings.map((f) => {
    const raw = typeof f.payload === 'object' && f.payload ? JSON.stringify(f.payload) : '';
    return {
      category: f.category,
      severity: f.severity,
      pageUrl: f.page_id ? pageUrlById.get(f.page_id) ?? null : null,
      detail: raw.length > MAX_DETAIL ? `${raw.slice(0, MAX_DETAIL)}…` : raw,
    };
  });
  const pageExports: PageExport[] = pages.map((p) => ({
    url: p.url, title: p.title, status_code: p.status_code, depth: p.depth, in_degree: p.in_degree, out_degree: p.out_degree, is_orphan: p.is_orphan,
  }));

  const zip = await buildAuditZip(findingExports, pageExports);
  return new Response(new Uint8Array(zip), {
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="crawlmouse-audit-${id}.zip"` },
  });
}
