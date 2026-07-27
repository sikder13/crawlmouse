import type { PublicReportSnapshot, WhiteLabelConfig } from '@crawlmouse/types';
import {
  ReportGradeSection,
  ReportExecutiveSummary,
  ReportFindings,
  ReportActionList,
  ReportMethodology,
  ReportFooter,
} from './sections';
import { ReportBrandHeader } from './ReportBrandHeader';
import { AiReadinessReportSection } from './AiReadinessReportSection';

// SPEC 04 §4 — the report body as an ORDERED LIST of self-contained sections. This array is the
// frozen seam SPEC 05 mounts into: it inserts its AI-readiness section here (a one-line addition)
// with zero edits to any section component. SPEC 04 builds NO AI-readiness content (ruling 6).
//
// SPEC 04 §5 — the brand letterhead (Crawlmouse, or the owner's brand when white-labeled) renders as a
// SIBLING above the sections array — the frozen seam is neither reordered nor modified. `whiteLabel` is
// null on every free/unclaimed report (the Crawlmouse-branded viral default).
export function ReportBody({
  snapshot,
  claimed,
  whiteLabel,
}: {
  snapshot: PublicReportSnapshot;
  claimed: boolean;
  whiteLabel?: WhiteLabelConfig | null;
}) {
  const sections = [
    <ReportGradeSection key="grade" snapshot={snapshot} />,
    <ReportExecutiveSummary key="summary" snapshot={snapshot} />,
    <ReportFindings key="findings" snapshot={snapshot} />,
    <ReportActionList key="actions" snapshot={snapshot} />,
    <ReportMethodology key="method" snapshot={snapshot} />,
    // SPEC 05 §10 (amendment v1.3) — the AI-readiness section, mounted in the slot SPEC 04 reserved.
    // Additive and null-safe: it renders nothing when the snapshot has no `aiReadiness` key, which is
    // every report minted before SPEC 05 (A13), so this is a no-op for existing reports. Diagnostic-only
    // — the snapshot carries no packet, excerpt or cure, so the report's gating stays structural.
    <AiReadinessReportSection key="ai" snapshot={snapshot} />,
  ];
  return (
    <>
      <ReportBrandHeader whiteLabel={whiteLabel} />
      {sections}
      <ReportFooter snapshot={snapshot} claimed={claimed} />
    </>
  );
}
