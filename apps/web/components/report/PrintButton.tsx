'use client';

// SPEC 04 §4 — "Download PDF" via the browser print path (no server-side PDF; COGS). The report has a
// dedicated @media print stylesheet, so print → save-as-PDF yields the client-ready document.
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print inline-flex items-center gap-2 border border-oat rounded-lg px-4 py-2 text-sm font-medium hover:bg-cream"
    >
      Download PDF
    </button>
  );
}
