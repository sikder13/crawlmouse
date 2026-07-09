import type { WhiteLabelConfig } from '@crawlmouse/types';
import { Card } from '@/components/ui/Card';
import { GradeCard } from '@/components/ui/GradeCard';
import { asNumber } from '@/lib/numeric';
import { isPassingScore } from '@/lib/limits';
import { ReportBrandHeader } from './ReportBrandHeader';

// The legacy-report fields the fallback reads (a subset of the public_reports row; widths match the DB so
// the /r/ page can pass its `report` row straight through). Kept minimal + pure so the null-snapshot +
// white_label combination is render-testable — the gap SPEC 04.1's source-string guard couldn't reach.
export interface LegacyReportView {
  grade: string | null;
  score: number | string | null;
  orphan_count: number | null;
  avg_depth: number | string | null;
  created_at: string;
  cms_detected: string | null;
  white_label?: WhiteLabelConfig | null;
}

// SPEC 04.2 FIX 1 — a report minted before SPEC 04 (no `report_snapshot`) renders from the denormalized
// columns. 04.1 wired white-label only into ReportBody, so a claimed/branded legacy report showed the
// Crawlmouse wordmark regardless of the owner's saved brand. The brand letterhead now renders here too —
// FIRST, inside the page's `.report-print` container — so the owner's brand appears on the page AND the
// printed PDF (the OG card already reads white_label unconditionally). Display-only: the snapshot/columns
// are untouched, and an unbranded (free/unclaimed) report keeps the Crawlmouse wordmark (the viral default).
export function ReportLegacyFallback({ report: r }: { report: LegacyReportView }) {
  return (
    <>
      <ReportBrandHeader whiteLabel={r.white_label} />
      <div className="text-xs text-ink/50 mt-1 mb-4">
        Audited {new Date(r.created_at).toLocaleDateString()} &middot; {r.cms_detected ?? 'custom'}
      </div>
      <GradeCard
        grade={r.grade!}
        score={asNumber(r.score) ?? 0}
        orphanCount={r.orphan_count ?? 0}
        avgDepth={asNumber(r.avg_depth) ?? 0}
        passing={isPassingScore(asNumber(r.score) ?? 0)}
      />
      <Card className="mt-6 text-center">
        <p className="font-display text-lg">Re-audit for the full report</p>
        <p className="text-sm text-ink/60 mt-1">This report predates our detailed breakdown — run a fresh audit for the executive summary, findings, and prioritised fixes.</p>
        <a href="/" className="inline-block mt-3 bg-peach text-white px-6 py-3 rounded-lg font-medium">Run a fresh audit &rarr;</a>
      </Card>
      <footer className="report-footer mt-10 border-t border-oat pt-6 text-xs text-ink/55 space-y-2">
        <p>
          Automated, deterministic analysis of publicly served HTML, as of {r.created_at.slice(0, 10)}.
          Results are a point-in-time snapshot — <a href="/" className="underline">run a fresh audit</a>.{' '}
          <a href="/bot" className="underline">Methodology</a>.
        </p>
        <p><a href="/takedown" className="underline">Dispute or request removal</a>.</p>
      </footer>
    </>
  );
}
