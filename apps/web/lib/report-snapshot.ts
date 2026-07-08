import type {
  Confidence,
  Finding,
  PublicReportSnapshot,
  ReportSnapshotFinding,
  ReportSnapshotLedgerItem,
} from '@crawlmouse/types';
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
  };
}
