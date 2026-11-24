/**
 * The name a report file downloads under (F-125): the site and the day the report was made, then
 * what it is, so a folder of downloads reads as a list of sites and dates rather than of ids. It goes
 * into the signed address's `download` parameter, which sets the response's file name; nothing in it
 * comes from outside our own records, and it is reduced to letters, digits, dots and hyphens.
 */
import { REPORT_FILES, type ReportFormat } from './generate';

export type ReportKindName = 'audit_pdf' | 'compare' | 'raw_export' | 'client_report';

const WHAT: Record<ReportKindName, string> = {
  audit_pdf: 'audit',
  compare: 'compare',
  raw_export: 'export',
  client_report: 'report',
};

/** Whether a report kind has a file name of its own here; the others keep the stored object's. */
export const isNamedKind = (kind: string): kind is ReportKindName => Object.hasOwn(WHAT, kind);

/** At most 100 characters of the host, so the whole name stays well under a file system's 255. */
const safe = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    .slice(0, 100);

export function reportFileName(r: {
  host: string;
  createdAt: string;
  kind: ReportKindName;
  format: ReportFormat;
}): string {
  const at = Date.parse(r.createdAt);
  const day = Number.isNaN(at) ? null : new Date(at).toISOString().slice(0, 10);
  const parts = ['crawlmouse', safe(r.host), ...(day ? [day] : []), WHAT[r.kind]];
  return `${parts.join('-')}.${REPORT_FILES[r.format].extension}`;
}
