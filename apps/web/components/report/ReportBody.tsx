import type { PublicReportSnapshot } from '@crawlmouse/types';
import {
  ReportGradeSection,
  ReportExecutiveSummary,
  ReportFindings,
  ReportActionList,
  ReportMethodology,
  ReportFooter,
} from './sections';

// SPEC 04 §4 — the report body as an ORDERED LIST of self-contained sections. This array is the
// frozen seam SPEC 05 mounts into: it inserts its AI-readiness section here (a one-line addition)
// with zero edits to any section component. SPEC 04 builds NO AI-readiness content (ruling 6).
export function ReportBody({ snapshot, claimed }: { snapshot: PublicReportSnapshot; claimed: boolean }) {
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
      {sections}
      <ReportFooter snapshot={snapshot} claimed={claimed} />
    </>
  );
}
