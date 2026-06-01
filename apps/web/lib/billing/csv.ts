import JSZip from 'jszip';

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Neutralize spreadsheet formula injection: titles/anchors are crawled from arbitrary
  // third-party sites. Check the first NON-whitespace char (spreadsheets trim leading
  // whitespace on import, so " =cmd" would otherwise still execute in Excel/Sheets).
  const firstNonSpace = s.replace(/^\s+/, '').charAt(0);
  if (firstNonSpace && '=+-@'.includes(firstNonSpace)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (cells: unknown[]) => cells.map(csvCell).join(',');

export interface FindingExport { category: string; severity: string; pageUrl: string | null; detail: string }
export interface PageExport { url: string; title: string | null; status_code: number; depth: number | null; in_degree: number; out_degree: number; is_orphan: boolean }

export function buildFindingsCsv(findings: FindingExport[]): string {
  return [row(['category', 'severity', 'page_url', 'detail']), ...findings.map((f) => row([f.category, f.severity, f.pageUrl, f.detail]))].join('\n') + '\n';
}
export function buildPagesCsv(pages: PageExport[]): string {
  return [
    row(['url', 'title', 'status_code', 'depth', 'in_degree', 'out_degree', 'is_orphan']),
    ...pages.map((p) => row([p.url, p.title, p.status_code, p.depth, p.in_degree, p.out_degree, p.is_orphan])),
  ].join('\n') + '\n';
}
export async function buildAuditZip(findings: FindingExport[], pages: PageExport[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('findings.csv', buildFindingsCsv(findings));
  zip.file('pages.csv', buildPagesCsv(pages));
  return zip.generateAsync({ type: 'nodebuffer' });
}
