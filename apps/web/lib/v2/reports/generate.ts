/**
 * Reports (CC-31 D6): what a request names, the document a report is, and where its file is kept.
 *
 * A report's content is a `ReportDoc`: titles, tables and before-and-after pairs, as strings.
 * `docStrings` lists them, for the tests that compare what a renderer drew with what its document
 * holds. A raw export (CSV, JSON, edge list) is the check's rows and has no document.
 */
import { z } from 'zod';

const Id = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'a lowercase UUID');

/** The private bucket report files are stored in (migration 20261102000003). */
export const REPORTS_BUCKET = 'reports';

export const RAW_EXPORT_FORMATS = ['csv', 'json', 'edge_list'] as const;

/**
 * `POST /api/reports`: one of three requests. `compare` sets `checkId` (the later check) beside the
 * earlier one (`previousCheckId`, the name the Reports screen posts it under), or beside a fix the
 * later check verified; with neither it is the baseline page of that one check.
 */
export const ReportRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('audit_pdf'), siteId: Id, checkId: Id }),
  z.strictObject({
    kind: z.literal('compare'),
    siteId: Id,
    checkId: Id,
    previousCheckId: Id.optional(),
    fixId: Id.optional(),
  }),
  z.strictObject({
    kind: z.literal('raw_export'),
    siteId: Id,
    checkId: Id,
    format: z.enum(RAW_EXPORT_FORMATS),
  }),
]);

export type ReportRequest = z.infer<typeof ReportRequestSchema>;

/** One side of a before-and-after pair: what a check held, when, and the evidence for it. */
export interface DocSide {
  label: string;
  date: string;
  value: string;
  evidence: string[];
}

export type DocBlock =
  | { type: 'text'; text: string }
  | { type: 'facts'; rows: { label: string; value: string }[] }
  | { type: 'table'; caption: string; columns: string[]; rows: string[][] }
  | { type: 'pair'; title: string; before: DocSide; after: DocSide };

export interface DocSection {
  heading: string;
  blocks: DocBlock[];
}

export interface ReportDoc {
  title: string;
  /** Under the title: the site, and when it was checked. */
  lines: string[];
  sections: DocSection[];
  /** What the check did not measure, each as its page states it. */
  notMeasured: string[];
  /** The one line every report ends with, and the address it links. */
  footer: { text: string; href: string };
}

function blockStrings(b: DocBlock): string[] {
  switch (b.type) {
    case 'text':
      return [b.text];
    case 'facts':
      return b.rows.flatMap((r) => [r.label, r.value]);
    case 'table':
      return [b.caption, ...b.columns, ...b.rows.flat()];
    case 'pair':
      return [
        b.title,
        ...[b.before, b.after].flatMap((s) => [s.label, s.date, s.value, ...s.evidence]),
      ];
  }
}

/** Every string a `ReportDoc` holds, in reading order. */
export function docStrings(doc: ReportDoc): string[] {
  return [
    doc.title,
    ...doc.lines,
    ...doc.sections.flatMap((s) => [s.heading, ...s.blocks.flatMap(blockStrings)]),
    ...doc.notMeasured,
    doc.footer.text,
    doc.footer.href,
  ];
}

/** What is stored for each format: a proof page (`html`) is stored as its `ReportDoc`, in JSON. */
export const REPORT_FILES = {
  pdf: { extension: 'pdf', contentType: 'application/pdf' },
  csv: { extension: 'csv', contentType: 'text/csv; charset=utf-8' },
  json: { extension: 'json', contentType: 'application/json' },
  edge_list: { extension: 'edges.csv', contentType: 'text/csv; charset=utf-8' },
  html: { extension: 'doc.json', contentType: 'application/json' },
} as const;

export type ReportFormat = keyof typeof REPORT_FILES;

export interface ReportFile {
  bytes: Uint8Array;
  contentType: string;
}

/** A report's object name in the bucket: its account's folder, then the report's own id. */
export function reportPath(accountId: string, reportId: string, format: ReportFormat): string {
  for (const id of [accountId, reportId]) Id.parse(id);
  return `${accountId}/${reportId}.${REPORT_FILES[format].extension}`;
}
