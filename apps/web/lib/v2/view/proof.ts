/**
 * The proof page as data (CC-31 D6b): a stored `ReportDoc` laid out for the screen. Every string
 * here is one the document holds, or a label of `PROOF_COPY` where the layout needs one and the
 * document has none. Nothing is computed from the document's values, and nothing of it is left out:
 * a table row longer than its header keeps its cells, under unnamed columns.
 */
import type { DocBlock, DocSection, DocSide, ReportDoc } from '../reports/generate';
import { PROOF_COPY as COPY } from '../copy/proof';

export interface ProofSideView {
  label: string;
  date: string;
  value: string;
  evidence: string[];
}

export type ProofBlockView =
  | { type: 'text'; text: string }
  | { type: 'facts'; rows: { label: string; value: string }[] }
  | {
      type: 'table';
      /** Names the table for assistive technology: its caption, else its section's heading. */
      label: string;
      caption: string;
      columns: string[];
      rows: string[][];
    }
  | { type: 'pair'; title: string; before: ProofSideView; after: ProofSideView };

export interface ProofSectionView {
  heading: string;
  blocks: ProofBlockView[];
}

export interface ProofView {
  title: string;
  lines: string[];
  sections: ProofSectionView[];
  /** Null when the document lists nothing that was not measured. */
  notMeasured: { title: string; items: string[] } | null;
  /** `href` is null unless the document's address is an https one. */
  footer: { text: string; href: string | null };
}

const side = (s: DocSide, fallback: string): ProofSideView => ({
  label: s.label === '' ? fallback : s.label,
  date: s.date,
  value: s.value,
  evidence: s.evidence,
});

function block(b: DocBlock, heading: string, title: string): ProofBlockView {
  switch (b.type) {
    case 'text':
    case 'facts':
      return b;
    case 'table': {
      const width = Math.max(b.columns.length, ...b.rows.map((r) => r.length));
      const padded = (cells: string[]) => [
        ...cells,
        ...Array.from({ length: width - cells.length }, () => ''),
      ];
      return {
        type: 'table',
        label: b.caption || heading || title,
        caption: b.caption,
        columns: padded(b.columns),
        rows: b.rows.map(padded),
      };
    }
    case 'pair':
      return {
        type: 'pair',
        title: b.title,
        before: side(b.before, COPY.before),
        after: side(b.after, COPY.after),
      };
  }
}

const section = (s: DocSection, title: string): ProofSectionView => ({
  heading: s.heading,
  blocks: s.blocks.map((b) => block(b, s.heading, title)),
});

/** An address a stored document may link: an absolute https URL, and nothing else. */
function httpsUrl(href: string): string | null {
  try {
    return new URL(href).protocol === 'https:' ? href : null;
  } catch {
    return null;
  }
}

export function proofView(doc: ReportDoc): ProofView {
  return {
    title: doc.title,
    lines: doc.lines,
    sections: doc.sections.map((s) => section(s, doc.title)),
    notMeasured: doc.notMeasured.length
      ? { title: COPY.notMeasured, items: doc.notMeasured }
      : null,
    footer: { text: doc.footer.text, href: httpsUrl(doc.footer.href) },
  };
}
