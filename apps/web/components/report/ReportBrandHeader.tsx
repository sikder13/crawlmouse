import type { WhiteLabelConfig } from '@crawlmouse/types';
import { whiteLabelBrandName, logoPublicUrl } from '@/lib/report-brand';

// SPEC 04 §5 (V9) — the report's brand letterhead. A claimed Pro report shows the owner's brand (name +
// optional logo); every other report shows the Crawlmouse wordmark (the viral vector — that asymmetry
// IS the business model). Rendered inside the `.report-print` container (via ReportBody), so it appears
// on the report page AND the printed PDF. `brandName` is owner-supplied text → a plain React text node
// (escaped by construction); the logo is a validator-checked image served from our storage CDN. No
// dangerouslySetInnerHTML anywhere.
export function ReportBrandHeader({ whiteLabel }: { whiteLabel?: WhiteLabelConfig | null }) {
  const brand = whiteLabelBrandName(whiteLabel);

  if (!brand) {
    // Crawlmouse-branded default (free / unclaimed / brand-off).
    return (
      <header className="report-brand mb-4">
        <span className="font-display text-lg font-semibold text-peach-text">Crawlmouse</span>
      </header>
    );
  }

  const logo = logoPublicUrl(whiteLabel?.logoPath);
  return (
    <header className="report-brand mb-4 flex items-center gap-3">
      {logo && <img src={logo} alt={brand} className="h-8 w-auto max-w-[200px] object-contain" />}
      <span className="font-display text-lg font-semibold text-ink">{brand}</span>
    </header>
  );
}
