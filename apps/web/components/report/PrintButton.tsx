'use client';

import { track } from '@/lib/analytics';

// SPEC 04 §4 — "Download PDF" via the browser print path (no server-side PDF; COGS). The report has a
// dedicated @media print stylesheet, so print → save-as-PDF yields the client-ready document. Fires the
// §13 `report_pdf_printed` funnel event on use.
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => { track('report_pdf_printed'); window.print(); }}
      className="no-print inline-flex items-center gap-2 border border-oat rounded-lg px-4 py-2 text-sm font-medium hover:bg-cream"
    >
      Download PDF
    </button>
  );
}
