import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Confidence,
  FindingCategory,
  MonitoringDelta,
  DashboardSite,
  DashboardSiteHistoryPoint,
  DashboardFixChecklistItem,
} from '@crawlmouse/types';
import { asNumber } from './numeric';

/** A fix as needed by the dashboard delta + checklist — the FREE diagnosis fields ONLY (never the
 * gated suggested_links / action_packet_body, which are not even read here). */
export interface FixRecord {
  fixId: string;
  category: string;
  targetTitle: string | null;
  targetUrl: string;
  marginalDelta: number;
}

export interface DeltaAudit {
  id: string;
  grade: string;
  score: number;
  completedAt: string;
}

// Factual category nouns for the checklist headline (data, not marketing copy — SPEC 03 owns visual framing).
const CATEGORY_NOUN: Record<string, string> = {
  orphan: 'Orphan page',
  near_orphan: 'Under-linked page',
  deep_page: 'Buried page',
  under_linked_important: 'Under-linked key page',
  over_optimized_anchor: 'Over-optimized anchor',
  generic_anchor_overuse: 'Generic anchor text',
  unreachable_page: 'Unreachable page',
  incomplete_crawl: 'Incomplete crawl',
  js_rendered: 'JavaScript-rendered',
};
function fixLabel(f: FixRecord): string {
  return `${CATEGORY_NOUN[f.category] ?? f.category}: ${f.targetTitle ?? f.targetUrl}`;
}

/**
 * The "what changed since last visit" delta (FREE — the retention hook, shown to the owner). Diffs the
 * latest audit against its predecessor by fix_id (the stable diagnosis ids). resolved = was present
 * last time and gone now (the user fixed it); new = appeared this time. null-safe on the first audit.
 */
export function computeMonitoringDelta(
  current: DeltaAudit,
  previous: DeltaAudit | null,
  currentFixIds: string[],
  previousFixIds: string[],
): MonitoringDelta {
  if (!previous) {
    return {
      previousAuditId: null,
      currentAuditId: current.id,
      scoreDelta: null,
      gradeFrom: null,
      gradeTo: current.grade,
      resolvedFixIds: [],
      newFixIds: [],
      ranAt: current.completedAt,
    };
  }
  const curSet = new Set(currentFixIds);
  const prevSet = new Set(previousFixIds);
  return {
    previousAuditId: previous.id,
    currentAuditId: current.id,
    scoreDelta: current.score - previous.score,
    gradeFrom: previous.grade,
    gradeTo: current.grade,
    resolvedFixIds: previousFixIds.filter((id) => !curSet.has(id)),
    newFixIds: currentFixIds.filter((id) => !prevSet.has(id)),
    ranAt: current.completedAt,
  };
}

/**
 * The open-loop fix checklist (GATED — Pro owner only; the caller passes it through only when entitled).
 * Open items = the latest audit's fixes (resolved=false); done items = the predecessor's fixes that are
 * GONE now (resolved=true). "3 of 7 done" → doneCount=resolved, total=items.length. Deterministic order:
 * open first then resolved, each by marginal impact desc then fixId.
 */
export function buildFixChecklist(
  currentFixes: FixRecord[],
  previousFixes: FixRecord[],
): { items: DashboardFixChecklistItem[]; doneCount: number } {
  const currentIds = new Set(currentFixes.map((f) => f.fixId));
  const toItem = (f: FixRecord, resolved: boolean): DashboardFixChecklistItem => ({
    fixId: f.fixId,
    label: fixLabel(f),
    category: f.category as FindingCategory,
    resolved,
    marginalDelta: f.marginalDelta,
  });
  const byImpact = (a: DashboardFixChecklistItem, b: DashboardFixChecklistItem): number =>
    b.marginalDelta - a.marginalDelta || (a.fixId < b.fixId ? -1 : a.fixId > b.fixId ? 1 : 0);
  const open = currentFixes.map((f) => toItem(f, false)).sort(byImpact);
  const resolved = previousFixes.filter((f) => !currentIds.has(f.fixId)).map((f) => toItem(f, true)).sort(byImpact);
  return { items: [...open, ...resolved], doneCount: resolved.length };
}

interface AuditRecord {
  id: string;
  url: string;
  grade: string | null;
  score: number | string | null;
  confidence: string | null;
  completed_at: string | null;
  previous_audit_id: string | null;
}
interface FixDbRow {
  audit_id: string;
  fix_id: string;
  category: string;
  target_title: string | null;
  target_url: string;
  marginal_delta: number | string | null;
}

/**
 * Load the signed-in owner's sites as `DashboardSite[]` — one per distinct URL, keyed on the latest
 * completed audit. The audits are read RLS-scoped (the caller's own); the service-role-only `fixes`
 * table is read via the admin client BUT scoped to the caller's own audit ids and SELECTING ONLY the
 * free diagnosis columns (never suggested_links/action_packet_body), so the gated cure never leaves the
 * DB here. `delta`/`history` are FREE; `fixChecklist`/`fixChecklistDoneCount` are populated only when
 * `isPro` (else null) — the cure-tracking checklist is the Pro retention loop.
 */
export async function loadDashboardSites(
  sbUser: SupabaseClient,
  admin: SupabaseClient,
  isPro: boolean,
): Promise<DashboardSite[]> {
  const { data, error } = await sbUser
    .from('audits')
    .select('id, url, grade, score, confidence, completed_at, previous_audit_id')
    .eq('status', 'completed')
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('completed_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  const audits = (data ?? []) as AuditRecord[];
  if (audits.length === 0) return [];

  const byId = new Map(audits.map((a) => [a.id, a]));
  // Audits are desc by completed_at, so the first row seen for a URL is its latest audit.
  const latestByUrl = new Map<string, AuditRecord>();
  for (const a of audits) if (!latestByUrl.has(a.url)) latestByUrl.set(a.url, a);
  const sites = [...latestByUrl.values()];

  // The audit ids whose fixes we need (each site's current + its predecessor, if it's one of ours).
  const fixAuditIds = new Set<string>();
  for (const cur of sites) {
    fixAuditIds.add(cur.id);
    if (cur.previous_audit_id && byId.has(cur.previous_audit_id)) fixAuditIds.add(cur.previous_audit_id);
  }

  const fixesByAudit = new Map<string, FixRecord[]>();
  if (fixAuditIds.size > 0) {
    const { data: fixData } = await admin
      .from('fixes')
      .select('audit_id, fix_id, category, target_title, target_url, marginal_delta') // NEVER the gated cure columns
      .in('audit_id', [...fixAuditIds]);
    for (const f of (fixData ?? []) as FixDbRow[]) {
      const arr = fixesByAudit.get(f.audit_id) ?? [];
      arr.push({ fixId: f.fix_id, category: f.category, targetTitle: f.target_title, targetUrl: f.target_url, marginalDelta: asNumber(f.marginal_delta) ?? 0 });
      fixesByAudit.set(f.audit_id, arr);
    }
  }

  return sites.map((cur) => {
    const prev = cur.previous_audit_id ? byId.get(cur.previous_audit_id) ?? null : null;
    const curFixes = fixesByAudit.get(cur.id) ?? [];
    const prevFixes = prev ? fixesByAudit.get(prev.id) ?? [] : [];
    const toDeltaAudit = (a: AuditRecord): DeltaAudit => ({ id: a.id, grade: a.grade ?? '', score: asNumber(a.score) ?? 0, completedAt: a.completed_at ?? '' });

    const delta = computeMonitoringDelta(
      toDeltaAudit(cur),
      prev ? toDeltaAudit(prev) : null,
      curFixes.map((f) => f.fixId),
      prevFixes.map((f) => f.fixId),
    );

    const history: DashboardSiteHistoryPoint[] = [];
    if (prev) history.push({ auditId: prev.id, score: asNumber(prev.score) ?? 0, grade: prev.grade ?? '', ranAt: prev.completed_at ?? '' });
    history.push({ auditId: cur.id, score: asNumber(cur.score) ?? 0, grade: cur.grade ?? '', ranAt: cur.completed_at ?? '' });

    let fixChecklist: DashboardFixChecklistItem[] | null = null;
    let fixChecklistDoneCount: number | null = null;
    if (isPro) {
      const cl = buildFixChecklist(curFixes, prevFixes);
      fixChecklist = cl.items;
      fixChecklistDoneCount = cl.doneCount;
    }

    return {
      siteUrl: cur.url,
      latestAuditId: cur.id,
      currentGrade: cur.grade ?? '',
      currentScore: asNumber(cur.score) ?? 0,
      confidence: (cur.confidence as Confidence | null) ?? 'high', // null (v1) → treat as a verdict, not an estimate
      delta,
      history,
      fixChecklist,
      fixChecklistDoneCount,
    };
  });
}
