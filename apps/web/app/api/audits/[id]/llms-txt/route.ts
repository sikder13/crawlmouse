import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isProActive } from '@/lib/pro';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { asNumber } from '@/lib/numeric';
import { buildLlmsTxt, type LlmsTxtPage } from '@/lib/llms-txt';

export const runtime = 'nodejs';

interface PageRow {
  url: string;
  title: string | null;
  pagerank: number | string | null;
  excluded_from_grade: boolean | null;
}

// SPEC 05 §9.3 — the Pro, owner-gated llms.txt GENERATOR. Owner+Pro-gated read of already-persisted pages
// (no crawl trigger, no new outbound fetch — §12). Compiles the artifact in-response (no storage), ordered
// PageRank-desc / URL-asc. Gating mirrors the CSV export route exactly (401 auth / 402 pro / 404 owner).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const { data: me } = await sb.from('users').select('pro_until').eq('id', user.id).maybeSingle();
  if (!isProActive(me?.pro_until ?? null)) return NextResponse.json({ error: 'pro_required' }, { status: 402 });

  const admin = supabaseAdmin();
  const { data: audit } = await admin.from('audits').select('id, url, user_id').eq('id', id)
    .maybeSingle<{ id: string; url: string; user_id: string | null }>();
  // Same response for missing OR not-owned — don't leak which audit ids exist (matches the export route).
  if (!audit || audit.user_id !== user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const pages = await fetchAll<PageRow>(admin, 'pages', 'url, title, pagerank, excluded_from_grade', id);
  // List the real, reachable content only — a blocked/dead page (excluded from the grade graph) has no
  // business in an "these are my pages" artifact.
  const llmsPages: LlmsTxtPage[] = pages
    .filter((p) => !p.excluded_from_grade)
    .map((p) => ({ url: p.url, title: p.title, pagerank: asNumber(p.pagerank) }));

  return new Response(buildLlmsTxt(audit.url, llmsPages), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="llms.txt"',
    },
  });
}
