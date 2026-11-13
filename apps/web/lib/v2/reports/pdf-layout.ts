/**
 * A `ReportDoc` laid out on A4 pages (CC-31 D6): the title and the lines under it, each section's
 * blocks, the not-measured list, and on each page the footer line and the page's number.
 *
 * `drawDoc` draws through a `PdfSink` and holds no PDF library, so a test can record what is drawn.
 * Each piece of text it draws names the string it comes from (`source`, the string's place in
 * `docStrings(doc)`) and the drawing of it (`instance`: a string drawn again, as a table's header on
 * a new page or the footer on each page, is a new instance). The pieces of one instance, joined, are
 * that string with each run of white space as one space: text is wrapped at white space, a word
 * wider than its column is broken between characters, and nothing is cut. `pdf-layout.test.ts`
 * holds this over generated documents; the one text that is not a string of the document is a
 * page's number (`PAGE_NUMBER`).
 *
 * A table's column names are drawn again at the top of each page the table runs onto. A row, a
 * before-and-after pair or a heading with its first lines moves to a new page when it would
 * otherwise be split and fits on one; a row or pair taller than a page runs on, line by line.
 */
import type { DocBlock, DocSide, ReportDoc } from './generate';

export type Face = 'regular' | 'semibold' | 'mono';
export type Tone = 'ink' | 'muted';

export interface TextStyle {
  face: Face;
  size: number;
  /** The line's height. */
  leading: number;
  tone: Tone;
}

/** The width of `text` in points, set in `style`'s face and size. */
export type Measure = (text: string, style: Pick<TextStyle, 'face' | 'size'>) => number;

/** `source` of a page's number: the one text that is not a string of the document. */
export const PAGE_NUMBER = -1;

export interface DrawnText {
  text: string;
  /** The left end of the baseline, in points from the page's left and top edges. */
  x: number;
  y: number;
  style: TextStyle;
  /** The string's place in `docStrings(doc)`, or `PAGE_NUMBER`. */
  source: number;
  /** One drawing of a string: each piece of it carries the same number. */
  instance: number;
  /** A space stood between the piece before this one and this one. */
  spaceBefore: boolean;
}

export interface PdfSink {
  /** Starts a page; what follows is drawn on it. */
  page(): void;
  text(t: DrawnText): void;
  /** A horizontal rule from `x` to `x + width`, `y` points from the top. */
  rule(r: { x: number; y: number; width: number }): void;
  /** A filled square mark. */
  mark(m: { x: number; y: number; size: number }): void;
  /** An area of the page that opens `href`. */
  link(l: { x: number; y: number; width: number; height: number; href: string }): void;
}

/** A4, in points. */
export const PAGE = { width: 595.28, height: 841.89 } as const;
const MARGIN = { x: 48, top: 52, bottom: 40 } as const;
const WIDTH = PAGE.width - 2 * MARGIN.x;

const STYLE = {
  title: { face: 'semibold', size: 22, leading: 28, tone: 'ink' },
  line: { face: 'mono', size: 9, leading: 13, tone: 'muted' },
  heading: { face: 'semibold', size: 13, leading: 18, tone: 'ink' },
  body: { face: 'regular', size: 10, leading: 14.5, tone: 'ink' },
  label: { face: 'regular', size: 9, leading: 13, tone: 'muted' },
  caption: { face: 'semibold', size: 10, leading: 14.5, tone: 'ink' },
  columnName: { face: 'semibold', size: 8.5, leading: 12, tone: 'muted' },
  cell: { face: 'regular', size: 9, leading: 12.5, tone: 'ink' },
  pairTitle: { face: 'semibold', size: 11, leading: 15.5, tone: 'ink' },
  sideLabel: { face: 'semibold', size: 9, leading: 13, tone: 'muted' },
  sideDate: { face: 'mono', size: 8.5, leading: 12, tone: 'muted' },
  sideValue: { face: 'semibold', size: 14, leading: 19, tone: 'ink' },
  evidence: { face: 'regular', size: 9, leading: 12.5, tone: 'ink' },
  footer: { face: 'regular', size: 8, leading: 11, tone: 'muted' },
  pageNumber: { face: 'mono', size: 8, leading: 11, tone: 'muted' },
} as const satisfies Record<string, TextStyle>;

const GAP = { block: 8, section: 20, column: 12, row: 4, footer: 10 } as const;
/** What a rule takes of the page's height, the space under it included. */
const RULE_HEIGHT = 6;
/** The footer line's width: the page's, less room for the page's number. */
const FOOTER_WIDTH = WIDTH - 40;

/** Where a line's baseline sits below the top of a row `height` points high. */
const baselineIn = (height: number, style: TextStyle): number =>
  (height - style.size) / 2 + style.size * 0.8;

/**
 * What separates words. White space, and U+0085 and U+0008, which the PDF library would widen or
 * drop from a line if they were left in it.
 */
const SEPARATORS = /[\s\u0085\u0008]+/u;

export interface WrappedLine {
  text: string;
  /** The line starts a new word: a space stood before it in the string. False for the first line. */
  spaceBefore: boolean;
}

/**
 * `text` as lines no wider than `width`: broken at white space, and inside a word only when the
 * word alone is wider than `width` (then between characters, each line holding at least one).
 */
export function wrapText(
  text: string,
  width: number,
  widthOf: (s: string) => number,
): WrappedLine[] {
  const lines: WrappedLine[] = [];
  const space = widthOf(' ');
  let current = '';
  let currentWidth = 0;
  let currentStartsWord = true;
  let drawn = false;
  const flush = () => {
    if (current === '') return;
    lines.push({ text: current, spaceBefore: drawn && currentStartsWord });
    drawn = true;
    current = '';
    currentWidth = 0;
    currentStartsWord = true;
  };
  for (const word of text.split(SEPARATORS)) {
    if (word === '') continue;
    const wordWidth = widthOf(word);
    if (wordWidth <= width) {
      if (current !== '' && currentWidth + space + wordWidth > width) flush();
      currentWidth = current === '' ? wordWidth : currentWidth + space + wordWidth;
      current = current === '' ? word : `${current} ${word}`;
      continue;
    }
    // A word wider than the column: it starts its own line and is broken between characters.
    flush();
    let startsWord = true;
    for (const character of Array.from(word)) {
      if (current !== '' && widthOf(current + character) > width) {
        currentStartsWord = startsWord;
        flush();
        startsWord = false;
      }
      current += character;
    }
    currentStartsWord = startsWord;
    currentWidth = widthOf(current);
  }
  flush();
  return lines;
}

/** One string to draw: where it comes from, how it is set, and its lines at the width given. */
interface Piece {
  source: number;
  style: TextStyle;
  lines: WrappedLine[];
  /** Points left of the column's edge. */
  indent: number;
}

interface Column {
  x: number;
  pieces: Piece[];
}

/**
 * Walks a document's strings in `docStrings`' order, giving each its place there. A layout function
 * asks for the next string as it reaches it, so a string drawn out of order would carry the place
 * of another, which the test would read back as the wrong text.
 */
class Sources {
  private next = 0;
  take(): number {
    return this.next++;
  }
}

class Flow {
  private y: number = MARGIN.top;
  private pageNumber = 0;
  private instances = 0;
  private readonly bottom: number;
  private readonly footerLines: WrappedLine[];

  constructor(
    private readonly sink: PdfSink,
    private readonly measure: Measure,
    private readonly footer: { text: string; href: string; source: number },
  ) {
    this.footerLines = this.wrap(footer.text, STYLE.footer, FOOTER_WIDTH);
    const footerHeight = Math.max(1, this.footerLines.length) * STYLE.footer.leading;
    this.bottom = PAGE.height - MARGIN.bottom - footerHeight - GAP.footer;
    if (this.bottom - MARGIN.top < 4 * STYLE.body.leading) {
      throw new Error('pdf: the footer leaves no room for the document on a page');
    }
    this.newPage();
  }

  wrap(text: string, style: TextStyle, width: number): WrappedLine[] {
    return wrapText(text, width, (s) => this.measure(s, style));
  }

  piece(text: string, source: number, style: TextStyle, width: number, indent = 0): Piece {
    return { source, style, lines: this.wrap(text, style, width - indent), indent };
  }

  /** The height left on the page. */
  private get room(): number {
    return this.bottom - this.y;
  }

  private get fullPage(): number {
    return this.bottom - MARGIN.top;
  }

  private newPage(): void {
    this.sink.page();
    this.pageNumber++;
    this.y = MARGIN.top;
    const top = this.bottom + GAP.footer;
    this.sink.rule({ x: MARGIN.x, y: top - 4, width: WIDTH });
    const instance = this.instances++;
    const { footer } = this;
    this.footerLines.forEach((line, i) => {
      this.sink.text({
        text: line.text,
        x: MARGIN.x,
        y: top + i * STYLE.footer.leading + baselineIn(STYLE.footer.leading, STYLE.footer),
        style: STYLE.footer,
        source: footer.source,
        instance,
        spaceBefore: line.spaceBefore,
      });
    });
    this.sink.link({
      x: MARGIN.x,
      y: top,
      width: FOOTER_WIDTH,
      height: Math.max(1, this.footerLines.length) * STYLE.footer.leading,
      href: footer.href,
    });
    const number = String(this.pageNumber);
    this.sink.text({
      text: number,
      x: MARGIN.x + WIDTH - this.measure(number, STYLE.pageNumber),
      y: top + baselineIn(STYLE.pageNumber.leading, STYLE.pageNumber),
      style: STYLE.pageNumber,
      source: PAGE_NUMBER,
      instance: this.instances++,
      spaceBefore: false,
    });
  }

  /** Moves to a new page when `height` does not fit what is left of this one and would fit a whole one. */
  keep(height: number): void {
    if (height > this.room && height <= this.fullPage && this.y > MARGIN.top) this.newPage();
  }

  /** `keep` for a table's row: the new page starts with `drawFirst`, which takes `extra` points. */
  keepUnder(height: number, extra: number, drawFirst: () => void): void {
    if (height > this.room && height + extra <= this.fullPage && this.y > MARGIN.top) {
      this.newPage();
      drawFirst();
    }
  }

  space(points: number): void {
    // Space at the top of a page is dropped.
    if (this.y > MARGIN.top) this.y = Math.min(this.bottom, this.y + points);
  }

  rule(): void {
    if (RULE_HEIGHT > this.room) this.newPage();
    this.sink.rule({ x: MARGIN.x, y: this.y + 1, width: WIDTH });
    this.y += RULE_HEIGHT;
  }

  static heightOf(columns: readonly Column[]): number {
    return Math.max(
      0,
      ...columns.map((c) => c.pieces.reduce((h, p) => h + p.lines.length * p.style.leading, 0)),
    );
  }

  /**
   * Draws the columns side by side, a line of each at a time, top-aligned. When the page ends
   * part-way, the rest runs on at the top of a new page, after `onNewPage` has drawn there.
   */
  columns(columns: readonly Column[], onNewPage?: () => void): void {
    const flat = columns.map((c) => ({
      x: c.x,
      lines: c.pieces.flatMap((piece) => {
        const instance = this.instances++;
        return piece.lines.map((line) => ({ piece, line, instance }));
      }),
    }));
    const rows = Math.max(0, ...flat.map((c) => c.lines.length));
    for (let k = 0; k < rows; k++) {
      const height = Math.max(...flat.map((c) => c.lines[k]?.piece.style.leading ?? 0));
      if (height > this.room) {
        this.newPage();
        onNewPage?.();
      }
      for (const column of flat) {
        const at = column.lines[k];
        if (!at) continue;
        this.sink.text({
          text: at.line.text,
          x: column.x + at.piece.indent,
          y: this.y + baselineIn(height, at.piece.style),
          style: at.piece.style,
          source: at.piece.source,
          instance: at.instance,
          spaceBefore: at.line.spaceBefore,
        });
      }
      this.y += height;
    }
  }

  /** One string as a paragraph across the page's width. */
  paragraph(text: string, source: number, style: TextStyle): void {
    this.columns([{ x: MARGIN.x, pieces: [this.piece(text, source, style, WIDTH)] }]);
  }

  /** A paragraph with a square mark before its first line. */
  marked(piece: Piece): void {
    if (piece.style.leading > this.room) this.newPage();
    const size = 3;
    this.sink.mark({ x: MARGIN.x, y: this.y + (piece.style.leading - size) / 2, size });
    this.columns([{ x: MARGIN.x, pieces: [piece] }]);
  }
}

/** The space between a table's columns: narrower when there are many, so the columns keep most of the width. */
const gapFor = (columns: number): number => Math.min(GAP.column, WIDTH / (3 * columns));

/** Column widths for a table: by each column's widest text, within bounds, filling the page's width. */
function columnWidths(natural: readonly number[]): number[] {
  const n = natural.length;
  if (n === 0) return [];
  const inner = WIDTH - gapFor(n) * (n - 1);
  const floor = Math.min(56, inner / n);
  const capped = natural.map((w) => Math.min(Math.max(w, floor), inner * 0.55));
  const total = capped.reduce((a, b) => a + b, 0);
  return capped.map((w) => (w / total) * inner);
}

function table(
  flow: Flow,
  measure: Measure,
  sources: Sources,
  block: Extract<DocBlock, { type: 'table' }>,
): void {
  const caption = sources.take();
  const names = block.columns.map((name) => ({ name, source: sources.take() }));
  const rows = block.rows.map((row) => row.map((cell) => ({ cell, source: sources.take() })));
  // A row holds as many cells as it was given; the table is as wide as its widest row.
  const count = rows.reduce((n, r) => Math.max(n, r.length), names.length);
  const natural = Array.from({ length: count }, (_, i) =>
    rows.reduce(
      (w, r) => Math.max(w, r[i] ? measure(r[i].cell, STYLE.cell) : 0),
      names[i] ? measure(names[i].name, STYLE.columnName) : 0,
    ),
  );
  const widths = columnWidths(natural);
  const xs: number[] = [];
  widths.reduce((x, w) => {
    xs.push(x);
    return x + w + gapFor(count);
  }, MARGIN.x);
  const header: Column[] = names.map(({ name, source }, i) => ({
    x: xs[i]!,
    pieces: [flow.piece(name, source, STYLE.columnName, widths[i]!)],
  }));
  const headerHeight = Flow.heightOf(header) + RULE_HEIGHT;
  const drawHeader = () => {
    flow.columns(header);
    flow.rule();
  };

  const captionPiece = flow.piece(block.caption, caption, STYLE.caption, WIDTH);
  const first: Column[] = (rows[0] ?? []).map(({ cell, source }, i) => ({
    x: xs[i]!,
    pieces: [flow.piece(cell, source, STYLE.cell, widths[i]!)],
  }));
  flow.keep(
    Flow.heightOf([{ x: MARGIN.x, pieces: [captionPiece] }]) + headerHeight + Flow.heightOf(first),
  );
  flow.columns([{ x: MARGIN.x, pieces: [captionPiece] }]);
  flow.space(2);
  drawHeader();
  rows.forEach((row, n) => {
    const columns: Column[] =
      n === 0
        ? first
        : row.map(({ cell, source }, i) => ({
            x: xs[i]!,
            pieces: [flow.piece(cell, source, STYLE.cell, widths[i]!)],
          }));
    const height = Flow.heightOf(columns) + GAP.row;
    // A row that would be split moves whole to a new page, under the column names.
    if (n > 0) flow.keepUnder(height, headerHeight, drawHeader);
    flow.columns(columns, drawHeader);
    flow.space(GAP.row);
  });
}

function side(flow: Flow, sources: Sources, s: DocSide, x: number, width: number): Column {
  return {
    x,
    pieces: [
      flow.piece(s.label, sources.take(), STYLE.sideLabel, width),
      flow.piece(s.date, sources.take(), STYLE.sideDate, width),
      flow.piece(s.value, sources.take(), STYLE.sideValue, width),
      ...s.evidence.map((e) => flow.piece(e, sources.take(), STYLE.evidence, width)),
    ],
  };
}

function block(flow: Flow, measure: Measure, sources: Sources, b: DocBlock): void {
  switch (b.type) {
    case 'text':
      flow.paragraph(b.text, sources.take(), STYLE.body);
      return;
    case 'facts': {
      const labelWidth = WIDTH * 0.38;
      for (const row of b.rows) {
        const columns: Column[] = [
          {
            x: MARGIN.x,
            pieces: [flow.piece(row.label, sources.take(), STYLE.label, labelWidth)],
          },
          {
            x: MARGIN.x + labelWidth + GAP.column,
            pieces: [
              flow.piece(row.value, sources.take(), STYLE.body, WIDTH - labelWidth - GAP.column),
            ],
          },
        ];
        flow.keep(Flow.heightOf(columns));
        flow.columns(columns);
      }
      return;
    }
    case 'table':
      table(flow, measure, sources, b);
      return;
    case 'pair': {
      const half = (WIDTH - GAP.column * 2) / 2;
      const title = flow.piece(b.title, sources.take(), STYLE.pairTitle, WIDTH);
      const sides = [
        side(flow, sources, b.before, MARGIN.x, half),
        side(flow, sources, b.after, MARGIN.x + half + GAP.column * 2, half),
      ];
      flow.keep(Flow.heightOf([{ x: MARGIN.x, pieces: [title] }]) + Flow.heightOf(sides));
      flow.columns([{ x: MARGIN.x, pieces: [title] }]);
      flow.columns(sides);
      return;
    }
  }
}

/** Lays `doc` out and draws it through `sink`. */
export function drawDoc(doc: ReportDoc, measure: Measure, sink: PdfSink): void {
  const sources = new Sources();
  const title = sources.take();
  const lines = doc.lines.map(() => sources.take());
  // The footer is drawn on each page from the first, so its place is counted ahead: it follows
  // each section's strings and the not-measured list.
  const footerSource =
    1 +
    doc.lines.length +
    doc.sections.reduce((n, s) => n + 1 + s.blocks.reduce((m, b) => m + stringsIn(b), 0), 0) +
    doc.notMeasured.length;
  const flow = new Flow(sink, measure, { ...doc.footer, source: footerSource });

  flow.paragraph(doc.title, title, STYLE.title);
  flow.space(2);
  doc.lines.forEach((line, i) => flow.paragraph(line, lines[i]!, STYLE.line));

  for (const section of doc.sections) {
    flow.space(GAP.section);
    const heading = flow.piece(section.heading, sources.take(), STYLE.heading, WIDTH);
    // A heading is not left alone at the foot of a page.
    flow.keep(
      Flow.heightOf([{ x: MARGIN.x, pieces: [heading] }]) + RULE_HEIGHT + 3 * STYLE.body.leading,
    );
    flow.rule();
    flow.columns([{ x: MARGIN.x, pieces: [heading] }]);
    for (const b of section.blocks) {
      flow.space(GAP.block);
      block(flow, measure, sources, b);
    }
  }

  if (doc.notMeasured.length) {
    flow.space(GAP.section);
    flow.keep(RULE_HEIGHT + 2 * STYLE.body.leading);
    flow.rule();
    for (const sentence of doc.notMeasured) {
      const piece = flow.piece(sentence, sources.take(), STYLE.body, WIDTH, 12);
      flow.keep(Flow.heightOf([{ x: MARGIN.x, pieces: [piece] }]));
      flow.marked(piece);
      flow.space(GAP.row);
    }
  }
}

/** How many strings a block holds, as `docStrings` counts them. */
function stringsIn(b: DocBlock): number {
  switch (b.type) {
    case 'text':
      return 1;
    case 'facts':
      return 2 * b.rows.length;
    case 'table':
      return 1 + b.columns.length + b.rows.reduce((n, r) => n + r.length, 0);
    case 'pair':
      return 1 + 2 * 3 + b.before.evidence.length + b.after.evidence.length;
  }
}
