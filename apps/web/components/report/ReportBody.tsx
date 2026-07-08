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
    // ← SPEC 05 inserts its AI-readiness section here.
  ];
  return (
    <>
      <ReportBrandHeader whiteLabel={whiteLabel} />
      {sections}
      <ReportFooter snapshot={snapshot} claimed={claimed} />
    </>
  );
}
