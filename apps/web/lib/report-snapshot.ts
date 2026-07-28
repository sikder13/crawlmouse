import type {
  AiFinding,
  AiReadinessScore,
  Confidence,
  Finding,
  PublicReportSnapshot,
  ReportSnapshotAiFinding,
  ReportSnapshotAiReadiness,
  ReportSnapshotFinding,
  ReportSnapshotLedgerItem,
} from '@crawlmouse/types';
import { toPersistableText } from '@crawlmouse/engine';
import { asNumber } from './numeric';
import type { FixDbRow } from './conversion-from-fixes';

// SPEC 04 §4 — build the FROZEN report snapshot at mint from the audit's persisted data. This is the
// artifact the public report renders forever (it outlives the audit's 30-day TTL). It is FREE data
// only: the ledger is diagnosis-only (from the `fixes` rows' diagnosis fields, NEVER their
// suggested_links / action_packet_body), findings are capped per category and payload-stripped, and
// there is no place in `PublicReportSnapshot` to put a prescription — the gating is structural.
// Pure + deterministic: no clock/random; the same audit produces a byte-identical snapshot (V7).

export const REPORT_SNAPSHOT_VERSION = 1;
export const MAX_FINDINGS_PER_CATEGORY = 10;
/**
 * SPEC 05 §10 — AI findings kept in the frozen snapshot. The assembler emits these PER PAGE, so a
 * 500-page site produces thousands; `public_reports` is permanent and immutable, so an uncapped copy
 * would freeze a multi-hundred-KB artifact of which the report renders a handful. Mirrors the
 * MAX_FINDINGS_PER_CATEGORY discipline above.
 */
export const MAX_AI_FINDINGS = 25;
/** Bound on the two variable-length strings kept per AI finding (targetUrl is crawler-derived). */
export const MAX_AI_FINDING_BYTES = 400;
export const SNAPSHOT_LEDGER_DISCLAIMER =
  'Each impact is an individual estimate of that one fix’s effect on the grade — they are not additive and do not sum to a total.';

export interface SnapshotInput {
  domain: string;
  grade: string;
  score: number;
  cms: string | null;
  mintedAt: string;                    // ISO — passed in (never read the clock here → deterministic)
  pageCount: number;
  orphanCount: number;
  avgDepth: number | null;
  confidence: Confidence | null;
  coveragePct: number | null;
  estimatedTotal: number | null;
  projectedScore: number | null;
  projectedGrade: string | null;
  findings: Finding[];
  fixes: FixDbRow[];
  /**
   * SPEC 05 §10 — the persisted `audits.ai_readiness`. Nullable at the source (a v1 audit, one minted
   * before the SPEC 05 migration, or one crawled with the `AI_READINESS_EXTRACTION` kill-switch off), so
   * null/undefined is a NORMAL case, not an error. See the omit-when-null rule in buildReportSnapshot.
   */
  aiReadiness?: AiReadinessScore | null;
}

/** Cap findings to MAX_FINDINGS_PER_CATEGORY per category, preserving input order; strip payloads. */
function capFindings(findings: Finding[]): ReportSnapshotFinding[] {
  const perCategory = new Map<string, number>();
  const out: ReportSnapshotFinding[] = [];
  for (const f of findings) {
    const n = perCategory.get(f.category) ?? 0;
    if (n >= MAX_FINDINGS_PER_CATEGORY) continue;
    perCategory.set(f.category, n + 1);
    out.push(f.pageUrl != null ? { category: f.category, severity: f.severity, pageUrl: f.pageUrl } : { category: f.category, severity: f.severity });
  }
  return out;
}

/** The FREE, diagnosis-only ledger: sort by marginalDelta desc; DROP every prescription field. */
function buildLedger(fixes: FixDbRow[]): ReportSnapshotLedgerItem[] {
  return [...fixes]
    .map((f) => ({
      category: f.category as ReportSnapshotLedgerItem['category'],
      targetUrl: f.target_url,
      targetTitle: f.target_title,
      marginalDelta: asNumber(f.marginal_delta) ?? 0,
      effort: (f.effort as ReportSnapshotLedgerItem['effort']) ?? 'low',
      rationale: f.rationale ?? '',
    }))
    .sort((a, b) => b.marginalDelta - a.marginalDelta);
}

/** Severity order for the AI cap: keep the findings that matter when we cannot keep them all. */
const AI_SEVERITY_RANK: Record<AiFinding['severity'], number> = { high: 0, medium: 1, info: 2 };

/**
 * Postgres REJECTS an unpaired surrogate in jsonb, so a naive cut through an emoji would fail the mint
 * INSERT and leave that report permanently un-mintable. This used to be a local implementation that
 * only avoided splitting a pair; it now delegates to the shared helper, which ALSO repairs a lone
 * surrogate that arrived intact (crawled JSON-LD can carry one — a cut-safe clamp does nothing for it).
 */
const clamp = (s: string): string => toPersistableText(s, MAX_AI_FINDING_BYTES);

/**
 * SPEC 05 §10 — project `AiReadinessScore` into the bounded, field-whitelisted snapshot shape.
 *
 * Two jobs, both load-bearing for a PERMANENT artifact:
 *  1. CAP — severity-sort (stable, so ties keep the assembler's deterministic order) and keep the top
 *     MAX_AI_FINDINGS. `totalFindings` carries the pre-cap count so the report's "…and N more" stays true.
 *  2. WHITELIST — rebuild each finding field-by-field rather than spreading, so a future field added to
 *     `AiFinding`/`AiReadinessScore` cannot silently reach a world-readable, immutable report. `id` and
 *     `targetTitle` are dropped: neither is rendered.
 */
export function projectAiReadinessForSnapshot(ai: AiReadinessScore): ReportSnapshotAiReadiness {
  const all = ai.findings ?? [];
  const ordered = [...all].sort((a, b) => AI_SEVERITY_RANK[a.severity] - AI_SEVERITY_RANK[b.severity]);
  const findings: ReportSnapshotAiFinding[] = ordered.slice(0, MAX_AI_FINDINGS).map((f) => ({
    kind: f.kind,
    severity: f.severity,
    evidence: f.evidence,
    plainLanguage: clamp(f.plainLanguage),
    targetUrl: f.targetUrl == null ? null : clamp(f.targetUrl),
  }));
  const c = ai.components;
  const m = ai.accessMatrix;
  return {
    score: ai.score,
    band: ai.band,
    // Rebuilt to DEPTH, not copied by reference. A one-level whitelist LOOKS complete while leaving every
    // nested object a pass-through, so a future field on components/basis/accessMatrix/llmsTxt would still
    // ride into a permanent, world-readable artifact. Pinned by a nested rogue-field test.
    // Written out rather than mapped: the weights are LITERAL types (25/40/20/15), which is what pins
    // the locked weighting at the type level. A generic helper would widen them to `number` and quietly
    // remove that guarantee.
    components: {
      access: { score: c.access.score, weight: c.access.weight },
      contentWithoutJs: { score: c.contentWithoutJs.score, weight: c.contentWithoutJs.weight },
      machineLegibility: { score: c.machineLegibility.score, weight: c.machineLegibility.weight },
      retrievalPath: { score: c.retrievalPath.score, weight: c.retrievalPath.weight },
    },
    confidence: ai.confidence,
    isEstimate: ai.isEstimate,
    basis: {
      pagesAnalyzed: ai.basis.pagesAnalyzed,
      siteJsRendered: ai.basis.siteJsRendered,
      retrievalPathBasis: ai.basis.retrievalPathBasis,
    },
    findings,
    // The persisted ledger is itself capped now, so `all.length` is a post-cap number on a large site.
    // Prefer the engine's stamped pre-cap count so the frozen report's "…and N more" stays true forever.
    totalFindings: ai.totalFindings ?? all.length,
    accessMatrix: {
      bots: (m.bots ?? []).map((b) => ({
        token: b.token,
        operator: b.operator,
        botClass: b.botClass,
        allowedPageRatio: b.allowedPageRatio,
        fullyBlocked: b.fullyBlocked,
        note: clamp(b.note),
      })),
      robotsTxtFound: m.robotsTxtFound,
      wafDetected: m.wafDetected,
      wafNote: m.wafNote == null ? null : clamp(m.wafNote),
    },
    llmsTxt: { present: ai.llmsTxt.present, parseable: ai.llmsTxt.parseable, note: clamp(ai.llmsTxt.note) },
    asOf: ai.asOf,
  };
}

export function buildReportSnapshot(input: SnapshotInput): PublicReportSnapshot {
  const hasProjection = input.projectedScore != null;
  return {
    version: REPORT_SNAPSHOT_VERSION,
    domain: input.domain,
    grade: input.grade,
    score: input.score,
    cms: input.cms,
    mintedAt: input.mintedAt,
    pageCount: input.pageCount,
    orphanCount: input.orphanCount,
    avgDepth: input.avgDepth,
    confidence: input.confidence,
    coveragePct: input.coveragePct,
    estimatedTotal: input.estimatedTotal,
    findings: capFindings(input.findings),
    ledger: buildLedger(input.fixes),
    ledgerDisclaimer: SNAPSHOT_LEDGER_DISCLAIMER,
    projected: hasProjection
      ? { grade: input.projectedGrade ?? input.grade, score: input.projectedScore as number }
      : null,
    // SPEC 05 §10 / amendment v1.3 — OMIT-WHEN-NULL. When the audit has no AI data the key is absent
    // from the object entirely (never an explicit `null`), so the in-memory serialization is
    // BYTE-IDENTICAL to pre-SPEC-05 output and SPEC 04's V7 determinism pin holds unchanged — which is
    // why REPORT_SNAPSHOT_VERSION stays at 1. (Key ORDER is not a contract once stored: Postgres jsonb
    // normalizes it. The load-bearing property is the identical key SET, which is order-independent.)
    // Projected, never spread — see projectAiReadinessForSnapshot for the cap + whitelist rationale.
    ...(input.aiReadiness ? { aiReadiness: projectAiReadinessForSnapshot(input.aiReadiness) } : {}),
  };
}
