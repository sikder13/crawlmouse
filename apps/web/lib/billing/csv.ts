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

/** Findings carry arbitrary crawled payloads; cap the exported detail so one finding can't
 *  balloon the CSV. Result is at most `max + 1` chars (the trailing ellipsis). */
export const MAX_CSV_DETAIL = 4000;
export function truncateDetail(raw: string, max = MAX_CSV_DETAIL): string {
  return raw.length > max ? `${raw.slice(0, max)}…` : raw;
}

export interface FindingExport { category: string; severity: string; pageUrl: string | null; detail: string }
export interface PageExport { url: string; title: string | null; status_code: number; depth: number | null; in_degree: number; out_degree: number; is_orphan: boolean }
/** SPEC 02 §3–§5 — the Pro cure export. Exported ONLY through the Pro+owner-gated export route. */
export interface PrescriptionExport {
  rank: number; fixId: string; isFreeFix: boolean; category: string; targetUrl: string; targetTitle: string | null;
  marginalDelta: number; effort: string | null; rationale: string | null; suggestedLinks: string; actionPacket: string;
}

export function buildFindingsCsv(findings: FindingExport[]): string {
  return [row(['category', 'severity', 'page_url', 'detail']), ...findings.map((f) => row([f.category, f.severity, f.pageUrl, f.detail]))].join('\n') + '\n';
}
export function buildPagesCsv(pages: PageExport[]): string {
  return [
    row(['url', 'title', 'status_code', 'depth', 'in_degree', 'out_degree', 'is_orphan']),
    ...pages.map((p) => row([p.url, p.title, p.status_code, p.depth, p.in_degree, p.out_degree, p.is_orphan])),
  ].join('\n') + '\n';
}
export function buildPrescriptionsCsv(rx: PrescriptionExport[]): string {
  return [
    row(['rank', 'fix_id', 'is_free_fix', 'category', 'target_url', 'target_title', 'marginal_delta', 'effort', 'rationale', 'suggested_links', 'action_packet']),
    ...rx.map((p) => row([p.rank, p.fixId, p.isFreeFix, p.category, p.targetUrl, p.targetTitle, p.marginalDelta, p.effort, p.rationale, p.suggestedLinks, p.actionPacket])),
  ].join('\n') + '\n';
}
export async function buildAuditZip(findings: FindingExport[], pages: PageExport[], prescriptions: PrescriptionExport[] = []): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('findings.csv', buildFindingsCsv(findings));
  zip.file('pages.csv', buildPagesCsv(pages));
  // The Pro cure export (SPEC 02). Only added when there are prescriptions (a v2 audit) — a v1 export
  // is byte-identical (no prescriptions.csv). The route that calls this is Pro+owner-gated.
  if (prescriptions.length > 0) zip.file('prescriptions.csv', buildPrescriptionsCsv(prescriptions));
  return zip.generateAsync({ type: 'nodebuffer' });
}
