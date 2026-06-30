import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isProActive } from '@/lib/pro';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { asNumber } from '@/lib/numeric';
import { buildAuditZip, truncateDetail, type FindingExport, type PageExport, type PrescriptionExport } from '@/lib/billing/csv';

export const runtime = 'nodejs';

interface PageRow { id: string; url: string; title: string | null; status_code: number; depth: number | null; in_degree: number; out_degree: number; is_orphan: boolean }
interface FindingRowDb { category: string; severity: string; page_id: string | null; payload: unknown }
interface FixRowDb {
  fix_id: string; rank: number; is_free_fix: boolean; category: string; target_url: string; target_title: string | null;
  marginal_delta: number | string | null; effort: string | null; rationale: string | null; suggested_links: unknown; action_packet_body: string | null;
}

/** Flatten a fix's suggested links to a readable cell (the cure source pages + anchors). */
function formatSuggestedLinks(raw: unknown): string {
  if (!Array.isArray(raw)) return '';
  return raw.map((l) => { const o = l as { fromUrl?: string; anchorText?: string }; return `${o.fromUrl ?? ''} → "${o.anchorText ?? ''}"`; }).join('; ');
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const { data: me } = await sb.from('users').select('pro_until').eq('id', user.id).maybeSingle();
  if (!isProActive(me?.pro_until ?? null)) return NextResponse.json({ error: 'pro_required' }, { status: 402 });

  const admin = supabaseAdmin();
  const { data: audit } = await admin.from('audits').select('id, user_id, confidence').eq('id', id)
    .maybeSingle<{ id: string; user_id: string | null; confidence: string | null }>();
  // Same response for missing OR not-owned — don't leak which audit ids exist to other users.
  if (!audit || audit.user_id !== user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // v2 discriminator (the pre-existing crawl-health `confidence`): only a v2 audit has a `fixes` row, so
  // the SPEC-02 fixes read below is gated on it — the v1 export path touches no SPEC-02 migration table
  // (deploy-order-independent, consistent with the SSE route).
  const isV2 = audit.confidence != null;

  const pages = await fetchAll<PageRow>(admin, 'pages', 'id, url, title, status_code, depth, in_degree, out_degree, is_orphan', id);
  const findings = await fetchAll<FindingRowDb>(admin, 'findings', 'category, severity, page_id, payload', id);
  const pageUrlById = new Map<string, string>(pages.map((p) => [p.id, p.url]));

  const findingExports: FindingExport[] = findings.map((f) => {
    const raw = typeof f.payload === 'object' && f.payload ? JSON.stringify(f.payload) : '';
    return {
      category: f.category,
      severity: f.severity,
      pageUrl: f.page_id ? pageUrlById.get(f.page_id) ?? null : null,
      detail: truncateDetail(raw),
    };
  });
  const pageExports: PageExport[] = pages.map((p) => ({
    url: p.url, title: p.title, status_code: p.status_code, depth: p.depth, in_degree: p.in_degree, out_degree: p.out_degree, is_orphan: p.is_orphan,
  }));

  // SPEC 02 — the Pro cure export (service-role read of the service-role-only fixes table). Safe here:
  // this route is already auth+Pro+owner gated above, so only an entitled owner reaches the gated cure.
  // v2-only: a v1 audit has no fixes + the read is skipped (no SPEC-02-table dependency on the v1 path).
  const fixes = isV2
    ? await fetchAll<FixRowDb>(admin, 'fixes', 'fix_id, rank, is_free_fix, category, target_url, target_title, marginal_delta, effort, rationale, suggested_links, action_packet_body', id)
    : [];
  const prescriptionExports: PrescriptionExport[] = fixes
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((f) => ({
      rank: f.rank,
      fixId: f.fix_id,
      isFreeFix: f.is_free_fix,
      category: f.category,
      targetUrl: f.target_url,
      targetTitle: f.target_title,
      marginalDelta: asNumber(f.marginal_delta) ?? 0,
      effort: f.effort,
      rationale: f.rationale,
      suggestedLinks: truncateDetail(formatSuggestedLinks(f.suggested_links)),
      actionPacket: truncateDetail(f.action_packet_body ?? ''),
    }));

  const zip = await buildAuditZip(findingExports, pageExports, prescriptionExports);
  return new Response(new Uint8Array(zip), {
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="crawlmouse-audit-${id}.zip"` },
  });
}
