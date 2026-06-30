import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { deriveTier, entitlementFor } from '@/lib/entitlement';
import { groupAndCapFindings, mapFindingRows, type FindingRow } from '@/lib/findings';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { asNumber } from '@/lib/numeric';
import { aggregateGraphStats } from '@/lib/audit-stats';
import { assembleGraph, FREE_GRAPH_NODE_CAP, PRO_GRAPH_NODE_CAP, type RawGraphEdge } from '@/lib/graph-assembly';
import { reconstructConversion, type FixDbRow } from '@/lib/conversion-from-fixes';
import { computeMonitoringDelta } from '@/lib/dashboard';
import { projectAuditForClient, type AuditRow, type ConversionProjectionInput } from '@/lib/audit-stream-projection';
import { SSE_POLL_MS, SSE_SELF_CLOSE_MS } from '@/lib/limits';
import type { GraphData, ConfidenceBand, ProjectedGrade, FreeFix, FixPrescription, MonitoringDelta } from '@crawlmouse/types';

// Gradeable-page row read for the live graph (SPEC 02 v1.2). Carries the node fields + the
// excluded_from_grade flag (filtered to the gradeable graph) and `id` (to resolve link page-ids → urls).
// Superset of GraphStatPage (is_orphan/depth), so it also feeds aggregateGraphStats — one read.
interface GraphPageRow {
  id: string;
  url: string;
  title: string | null;
  depth: number | null;
  is_orphan: boolean;
  pagerank: number | null;
  in_degree: number | null;
  out_degree: number | null;
  excluded_from_grade: boolean | null;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Hold the stream open for the crawl instead of being killed mid-poll and churning
// EventSource reconnects. Vercel Fluid Compute allows up to 300s (Hobby) / 800s (Pro).
// NOTE: Next's route-segment validator requires this to be a STATIC literal — an imported
// constant trips "can't recognize the exported `config` field" at build. Keep it == SSE_MAX_DURATION_S.
export const maxDuration = 300;

// Capability-URL model: the audit is read by its unguessable UUID via the service-role
// client (so an anonymous owner — user_id = null — can see their own result), exactly
// like a public report slug. user_id (owner/Pro gate) and the raw failure_reason are read
// server-side but NEVER sent to the client — projectAuditForClient strips them and emits
// only a coarse, classified failureCategory. settings carries only the page cap.
const AUDIT_COLS =
  'id, url, status, grade, score, page_count, link_count, cms_detected, user_id, settings, failure_reason, confidence, coverage_pct, block_rate, partial';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = supabaseAdmin();
  const sbAuth = await supabaseServer();

  // Completion payload: cap findings SERVER-SIDE so a non-Pro client never receives the
  // gated rows, and compute the headline graph stats. Reads go through the service-role
  // client so anonymous audits resolve; findings are paged so big Pro audits aren't
  // truncated at PostgREST's ~1000-row cap.
  async function buildDone(row: AuditRow) {
    if (row.status !== 'completed') return projectAuditForClient(row);
    // v2 discriminator (from the row's crawl-health, an EXISTING column): only a v2-engine audit carries
    // the conversion core. DEPLOY-SAFETY: the v1 path reads ONLY the legacy stats columns and touches no
    // SPEC-02 migration column (pagerank / confidence_band / projected_* / previous_audit_id are read
    // ONLY inside the isV2 block below) — so this route is deploy-order-independent and v1 byte-identical
    // even before the additive migration is applied / the ENGINE_V2 flag flips.
    const isV2 = row.confidence != null;
    const pagesSelect = isV2
      ? 'id, url, title, depth, is_orphan, pagerank, in_degree, out_degree, excluded_from_grade'
      : 'is_orphan, depth';
    // Independent reads — run them together (fires once per audit at the terminal poll).
    const [findings, pages, { data: { user } }] = await Promise.all([
      fetchAll<FindingRow>(admin, 'findings', 'category, severity, pages(url)', id),
      fetchAll<GraphPageRow>(admin, 'pages', pagesSelect, id),
      sbAuth.auth.getUser(),
    ]);
    // §7 entitlement — OWNER-SCOPED, derived SERVER-SIDE. A non-owner viewer (even another Pro) gets
    // the free view; the owner's tier comes from their own users row (RLS permits self-read).
    const isOwner = !!(user && user.id === row.user_id);
    const ownerRow = isOwner && user
      ? (await sbAuth.from('users').select('pro_until').eq('id', user.id).maybeSingle()).data
      : null;
    const tier = deriveTier(ownerRow);
    const entitlement = entitlementFor(tier, ownerRow?.pro_until ?? null);
    const viewerIsPro = tier === 'pro' || tier === 'agency'; // legacy key (owner-scoped: ownerRow is null for non-owners)
    const findingGroups = groupAndCapFindings(findings, viewerIsPro, undefined, isV2); // D4: v2 retires the volume cap
    const { orphanCount, avgDepth } = aggregateGraphStats(pages);

    // v2-only conversion core + live graph. EVERY read/derivation below is gated on isV2, so the v1 path
    // is byte-identical (no fixes/links read, no SPEC-02 migration column touched).
    let graph: GraphData | null = null;
    let confidenceBand: ConfidenceBand | null = null;
    let projectedGrade: ProjectedGrade | null = null;
    let freeFix: FreeFix | null = null;
    let prescriptions: FixPrescription[] | null = null;
    let monitoring: MonitoringDelta | null = null;
    if (isV2) {
      // The live graph (FREE, the wow), the persisted fix ledger/cures, and the audit's conversion columns
      // — read together at the terminal event. (The graph reads all link rows once; a bounded subgraph
      // query is a future perf optimization for very dense Pro sites — output stays capped regardless.)
      const [links, fixes, convRes] = await Promise.all([
        fetchAll<{ from_page_id: string; to_page_id: string }>(admin, 'links', 'from_page_id, to_page_id', id),
        fetchAll<FixDbRow>(admin, 'fixes', 'fix_id, category, target_url, target_title, marginal_delta, effort, rationale, rank, is_free_fix, suggested_links, action_packet_body', id),
        admin.from('audits').select('confidence_band, projected_score, projected_grade, previous_audit_id, completed_at').eq('id', id)
          .maybeSingle<{ confidence_band: unknown; projected_score: number | string | null; projected_grade: string | null; previous_audit_id: string | null; completed_at: string | null }>(),
      ]);
      const conv = convRes.data;
      confidenceBand = (conv?.confidence_band as ConfidenceBand | null) ?? null;

      const idToUrl = new Map(pages.map((p) => [p.id, p.url]));
      const rawNodes = pages
        .filter((p) => !p.excluded_from_grade)
        .map((p) => ({ url: p.url, title: p.title ?? null, depth: p.depth, isOrphan: p.is_orphan, pagerank: p.pagerank ?? 0, inboundCount: p.in_degree ?? 0, outboundCount: p.out_degree ?? 0 }));
      const rawEdges: RawGraphEdge[] = links
        .map((l) => ({ fromUrl: idToUrl.get(l.from_page_id) ?? '', toUrl: idToUrl.get(l.to_page_id) ?? '' }))
        .filter((e) => e.fromUrl && e.toUrl);
      graph = assembleGraph(rawNodes, rawEdges, {
        homepageUrl: row.url,
        siteJsRendered: findings.some((f) => f.category === 'js_rendered'),
        nodeCap: viewerIsPro ? PRO_GRAPH_NODE_CAP : FREE_GRAPH_NODE_CAP,
        isFreeTier: !viewerIsPro,
      });

      // Reconstruct the §2/§3/§4 projection from the persisted fixes (inverse of inngest buildFixRows);
      // projectAuditForClient applies the owner-scoped gate (prescriptions/monitoring → owner+Pro only).
      const reco = reconstructConversion(fixes, {
        currentScore: asNumber(row.score) ?? 0,
        currentGrade: row.grade ?? '',
        projectedScore: asNumber(conv?.projected_score),
        projectedGrade: conv?.projected_grade ?? null,
      });
      projectedGrade = reco.projectedGrade;
      freeFix = reco.freeFix;
      prescriptions = reco.prescriptions;

      // §8 monitoring delta (GATED): computed only for the entitled OWNER of a re-audit (previous_audit_id).
      if (isOwner && viewerIsPro && conv?.previous_audit_id) {
        const { data: prev } = await admin.from('audits').select('id, grade, score, completed_at').eq('id', conv.previous_audit_id)
          .maybeSingle<{ id: string; grade: string | null; score: number | string | null; completed_at: string | null }>();
        if (prev) {
          const prevFixes = await fetchAll<{ fix_id: string }>(admin, 'fixes', 'fix_id', conv.previous_audit_id);
          monitoring = computeMonitoringDelta(
            { id: row.id, grade: row.grade ?? '', score: asNumber(row.score) ?? 0, completedAt: conv?.completed_at ?? '' },
            { id: prev.id, grade: prev.grade ?? '', score: asNumber(prev.score) ?? 0, completedAt: prev.completed_at ?? '' },
            fixes.map((f) => f.fix_id),
            prevFixes.map((f) => f.fix_id),
          );
        }
      }
    }

    // §3–§8 conversion-core payload. v2-only data flows through the owner-scoped projection; on v1 every
    // field is null/empty → byte-identical exposure. graph + viewerSignedIn are v1.2 FREE fields.
    const conversion: ConversionProjectionInput = {
      entitlement,
      isOwner,
      confidenceBand,
      projectedGrade,
      freeFix,
      prescriptions,
      monitoring,
      findings: isV2 ? mapFindingRows(findings) : [],
      orphanCount,
      avgDepth,
      viewerSignedIn: !!user,
      graph,
    };
    return { ...projectAuditForClient(row, conversion), findingGroups, viewerIsPro };
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let inFlight = false;
      const send = (event: string, payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        closed = true;
        try { controller.close(); } catch {}
      };
      // When we self-terminate before the function's maxDuration (see the interval below), emit a
      // `retry:` hint so the client's EventSource reconnects promptly (3s) and resumes polling,
      // rather than being truncated mid-write by the runtime kill.
      const sendRetry = () => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode('retry: 3000\n\n'));
        } catch {
          closed = true;
        }
      };
      const openedAt = Date.now();
      // Always close the stream after the terminal event — even if buildDone's reads throw —
      // so a transient DB error can't leave the connection hanging until maxDuration. The
      // client's EventSource will reconnect and retry.
      const emitDoneAndFinish = async (row: AuditRow) => {
        try {
          send('done', await buildDone(row));
        } catch {
          send('error', { message: 'Could not load results.' });
        } finally {
          finish();
        }
      };

      const { data: initial } = await admin.from('audits').select(AUDIT_COLS).eq('id', id).maybeSingle<AuditRow>();
      if (initial) send('snapshot', projectAuditForClient(initial));

      // Short-circuit: audit already finished at load → emit done immediately, never start polling.
      if (initial && (initial.status === 'completed' || initial.status === 'failed' || initial.status === 'canceled')) {
        await emitDoneAndFinish(initial);
        return;
      }

      const interval = setInterval(async () => {
        if (closed) return;
        // Self-terminate before Vercel kills the function at maxDuration: emit a retry hint and
        // close so the client reconnects and resumes polling cleanly. A genuinely stuck audit thus
        // degrades to a clean reconnect instead of a hard mid-write runtime kill.
        if (Date.now() - openedAt >= SSE_SELF_CLOSE_MS) {
          clearInterval(interval);
          sendRetry();
          finish();
          return;
        }
        if (inFlight) return; // guard against overlapping ticks (a slow tick + the next)
        inFlight = true;
        try {
          const { data } = await admin.from('audits').select(AUDIT_COLS).eq('id', id).maybeSingle<AuditRow>();
          if (!data || closed) return;
          send('progress', projectAuditForClient(data));
          if (data.status === 'completed' || data.status === 'failed' || data.status === 'canceled') {
            clearInterval(interval);
            await emitDoneAndFinish(data);
          }
        } finally {
          inFlight = false;
        }
      }, SSE_POLL_MS);

      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        finish();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
