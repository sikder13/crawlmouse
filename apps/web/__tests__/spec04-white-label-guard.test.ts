import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC 04 §5 (V9) — the white-label brand replaces Crawlmouse on THREE surfaces: the report page/body,
// the print/PDF (same `.report-print` container), and that report's OG card. The body swap is unit-
// tested (ReportBody.test), but the page-thread and the satori OG swap aren't reachable by a render
// test — this guard pins that wiring so a refactor can't silently drop a surface (and the free/unclaimed
// default stays Crawlmouse). FAILS LOUD (ENOENT) if a file is renamed.
const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('white-label brand swap is wired on every branded surface (§5)', () => {
  it('ReportBody renders the brand letterhead as a sibling above the frozen sections array', () => {
    const body = read('components/report/ReportBody.tsx');
    expect(body).toContain('ReportBrandHeader');
    expect(body).toContain('whiteLabel');
  });

  it('the report page threads the report row white_label into ReportBody', () => {
    expect(read('app/r/[slug]/page.tsx')).toContain('whiteLabel={r.white_label}');
  });

  it('the OG card swaps its eyebrow to the white-label brand when set', () => {
    const og = read('app/r/[slug]/opengraph-image.tsx');
    expect(og).toContain('whiteLabelBrandName');
    expect(og).toContain('report.white_label');
  });

  it('the deploy-order-safe read path carries white_label to the branded surfaces', () => {
    const reports = read('lib/reports.ts');
    expect(reports).toMatch(/EXTENDED_REPORT_COLS\s*=[^\n]*white_label/);
  });
});
