/**
 * Test support for the report PDF: generated `ReportDoc`s, a sink that records what is drawn, and
 * the reading-back of what it recorded.
 */
import fc from 'fast-check';
import { docStrings, type DocBlock, type DocSide, type ReportDoc } from './generate';
import { PAGE_NUMBER, type DrawnText, type PdfSink } from './pdf-layout';

/** As the layout separates words: white space, U+0085 and U+0008, each run read as one space. */
export const collapse = (s: string): string =>
  s
    .split(/[\s\u0085\u0008]+/u)
    .filter((w) => w !== '')
    .join(' ');

export interface Recorded {
  /** The texts drawn, in order, each with the page (from 1) it was drawn on. */
  texts: (DrawnText & { page: number })[];
  rules: number;
  marks: number;
  links: { page: number; href: string }[];
  pages: number;
}

/** A sink that draws nothing and keeps what it was given. */
export function recorder(): { sink: PdfSink; drawn: Recorded } {
  const drawn: Recorded = { texts: [], rules: 0, marks: 0, links: [], pages: 0 };
  return {
    drawn,
    sink: {
      page() {
        drawn.pages++;
      },
      text(t) {
        drawn.texts.push({ ...t, page: drawn.pages });
      },
      rule() {
        drawn.rules++;
      },
      mark() {
        drawn.marks++;
      },
      link(l) {
        drawn.links.push({ page: drawn.pages, href: l.href });
      },
    },
  };
}

/** Each drawing of a string, read back: the string's place, its pieces joined, and its pages. */
export function instancesOf(drawn: Recorded): { source: number; text: string; pages: number[] }[] {
  const byInstance = new Map<number, { source: number; text: string; pages: number[] }>();
  for (const t of drawn.texts) {
    const piece = (t.spaceBefore ? ' ' : '') + t.text;
    const at = byInstance.get(t.instance);
    if (at === undefined) {
      byInstance.set(t.instance, { source: t.source, text: piece, pages: [t.page] });
    } else {
      if (at.source !== t.source) throw new Error('one instance drew two strings');
      at.text += piece;
      at.pages.push(t.page);
    }
  }
  return [...byInstance.values()];
}

/**
 * What a drawing must hold for `doc`: each instance is a page's number or reads back as the string
 * at its place in `docStrings(doc)`; each string that has a character to draw is drawn (the
 * footer's address is where the footer links, and is not drawn); and each page carries the footer
 * line once and its own number. Returns the instances, for a test that asks more.
 */
export function expectDrawsTheDocument(doc: ReportDoc, drawn: Recorded) {
  const strings = docStrings(doc);
  const footerText = strings.length - 2;
  const footerHref = strings.length - 1;
  const instances = instancesOf(drawn);
  const numbers: string[] = [];
  const seen = new Set<number>();
  for (const i of instances) {
    if (i.source === PAGE_NUMBER) {
      numbers.push(i.text);
      continue;
    }
    if (i.source < 0 || i.source >= strings.length || i.source === footerHref) {
      throw new Error(`drew ${JSON.stringify(i.text)}, which is no string of the document`);
    }
    if (i.text !== collapse(strings[i.source]!)) {
      throw new Error(
        `drew ${JSON.stringify(i.text)} for ${JSON.stringify(collapse(strings[i.source]!))}`,
      );
    }
    seen.add(i.source);
  }
  const missing = strings
    .map((s, n) => ({ s, n }))
    .filter(({ s, n }) => n !== footerHref && collapse(s) !== '' && !seen.has(n))
    .map(({ s }) => s);
  if (missing.length) throw new Error(`not drawn: ${JSON.stringify(missing)}`);

  const pages = Array.from({ length: drawn.pages }, (_, n) => String(n + 1));
  if (JSON.stringify(numbers) !== JSON.stringify(pages)) {
    throw new Error(`page numbers ${JSON.stringify(numbers)} on ${drawn.pages} pages`);
  }
  if (collapse(strings[footerText]!) !== '') {
    const footers = instances.filter((i) => i.source === footerText);
    const onItsPage = footers.every((f, n) => f.pages.every((page) => page === n + 1));
    if (footers.length !== drawn.pages || !onItsPage) {
      throw new Error(
        `the footer is drawn on pages ${JSON.stringify(footers.map((f) => f.pages))}`,
      );
    }
  }
  return instances;
}

/** Strings as a crawl can hold them: words, long unbroken runs, white space of each kind, any script. */
const anyText: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: fc.lorem({ maxCount: 12 }) },
  { weight: 2, arbitrary: fc.string({ maxLength: 60 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'binary', maxLength: 40 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', maxLength: 40 }) },
  {
    weight: 1,
    arbitrary: fc
      .array(fc.constantFrom('a', 'W', '/', '-', '=', 'é', '漢', '🙂', '.'), {
        minLength: 30,
        maxLength: 400,
      })
      .map((c) => c.join('')),
  },
  {
    weight: 1,
    arbitrary: fc
      .array(fc.constantFrom('word', ' ', '\n', '\t', '\r\n', '\u0085', '\u0008', ' ', ' ', '\f'), {
        maxLength: 20,
      })
      .map((c) => c.join('')),
  },
  { weight: 1, arbitrary: fc.constant('') },
);

const side: fc.Arbitrary<DocSide> = fc.record({
  label: anyText,
  date: anyText,
  value: anyText,
  evidence: fc.array(anyText, { maxLength: 4 }),
});

const block: fc.Arbitrary<DocBlock> = fc.oneof(
  fc.record({ type: fc.constant('text' as const), text: anyText }),
  fc.record({
    type: fc.constant('facts' as const),
    rows: fc.array(fc.record({ label: anyText, value: anyText }), { maxLength: 5 }),
  }),
  fc.nat(7).chain((columns) =>
    fc.record({
      type: fc.constant('table' as const),
      caption: anyText,
      columns: fc.array(anyText, { minLength: columns, maxLength: columns }),
      // Rows of the table's width, and now and then one that is shorter or longer.
      rows: fc.array(
        fc.oneof(
          { weight: 5, arbitrary: fc.array(anyText, { minLength: columns, maxLength: columns }) },
          { weight: 1, arbitrary: fc.array(anyText, { maxLength: columns + 2 }) },
        ),
        { maxLength: 40 },
      ),
    }),
  ),
  fc.record({ type: fc.constant('pair' as const), title: anyText, before: side, after: side }),
);

/** Any `ReportDoc`, with a footer line short enough to leave a page its room. */
export const anyDoc: fc.Arbitrary<ReportDoc> = fc.record({
  title: anyText,
  lines: fc.array(anyText, { maxLength: 4 }),
  sections: fc.array(fc.record({ heading: anyText, blocks: fc.array(block, { maxLength: 5 }) }), {
    maxLength: 4,
  }),
  notMeasured: fc.array(anyText, { maxLength: 5 }),
  footer: fc.record({
    text: anyText,
    href: fc.oneof(fc.constant('https://crawlmouse.com/'), fc.webUrl(), anyText),
  }),
});
