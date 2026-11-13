import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ReportDoc } from './generate';
import { drawDoc, PAGE, PAGE_NUMBER, wrapText, type Measure } from './pdf-layout';
import {
  anyDoc,
  collapse,
  expectDrawsTheDocument,
  instancesOf,
  recorder,
} from './pdf-test-support';

/** A measure with no font: each character half its size wide, a wide one a whole size. */
const measure: Measure = (text, { size }) =>
  Array.from(text).reduce((w, c) => w + (c === 'W' || c === '漢' ? size : size / 2), 0);

const widthOf = (s: string) => measure(s, { face: 'regular', size: 10 });
const joined = (lines: { text: string; spaceBefore: boolean }[]) =>
  lines.map((l) => (l.spaceBefore ? ' ' : '') + l.text).join('');

function draw(doc: ReportDoc) {
  const { sink, drawn } = recorder();
  drawDoc(doc, measure, sink);
  return drawn;
}

const doc = (over: Partial<ReportDoc> = {}): ReportDoc => ({
  title: 'Audit report',
  lines: ['example.com'],
  sections: [],
  notMeasured: [],
  footer: { text: 'Checked with Crawlmouse · 25 Oct 2026', href: 'https://crawlmouse.com/' },
  ...over,
});

describe('wrapText', () => {
  it('breaks at white space, each line within the width', () => {
    expect(wrapText('one two three four', 40, widthOf)).toEqual([
      { text: 'one two', spaceBefore: false },
      { text: 'three', spaceBefore: true },
      { text: 'four', spaceBefore: true },
    ]);
  });

  it('breaks a word wider than the width between characters, and goes on after it', () => {
    const lines = wrapText('see https://example.com/a/very/long/path now', 50, widthOf);
    expect(lines).toEqual([
      { text: 'see', spaceBefore: false },
      { text: 'https://ex', spaceBefore: true },
      { text: 'ample.com/', spaceBefore: false },
      { text: 'a/very/lon', spaceBefore: false },
      { text: 'g/path now', spaceBefore: false },
    ]);
    expect(joined(lines)).toBe('see https://example.com/a/very/long/path now');
  });

  it('gives a character wider than the width a line of its own', () => {
    expect(wrapText('WW', 4, widthOf)).toEqual([
      { text: 'W', spaceBefore: false },
      { text: 'W', spaceBefore: false },
    ]);
  });

  it('has no line for a string with nothing to draw', () => {
    expect(wrapText('', 100, widthOf)).toEqual([]);
    expect(wrapText(' \n\t\u0085\u0008 ', 100, widthOf)).toEqual([]);
  });

  it('property: the lines joined are the string with each run of white space as one space', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.string({ unit: 'binary' }), fc.lorem()),
        fc.double({ min: 0.5, max: 300, noNaN: true }),
        (text, width) => {
          const lines = wrapText(text, width, widthOf);
          expect(joined(lines)).toBe(collapse(text));
          for (const line of lines) {
            expect(line.text).not.toBe('');
            expect(widthOf(line.text) <= width || Array.from(line.text).length === 1).toBe(true);
          }
        },
      ),
      { numRuns: 2000 },
    );
  });
});

describe('drawDoc', () => {
  it('draws the title, the lines, the footer line and the page’s number, and links the footer', () => {
    const drawn = draw(doc());
    expect(instancesOf(drawn).map((i) => i.text)).toEqual([
      'Checked with Crawlmouse · 25 Oct 2026',
      '1',
      'Audit report',
      'example.com',
    ]);
    expect(drawn.links).toEqual([{ page: 1, href: 'https://crawlmouse.com/' }]);
    expect(drawn.texts.find((t) => t.source === PAGE_NUMBER)!.text).toBe('1');
  });

  it('draws a pair’s two sides side by side', () => {
    const side = (label: string) => ({ label, date: '25 Oct', value: 'B', evidence: ['79'] });
    const drawn = draw(
      doc({
        sections: [
          {
            heading: 'Grades',
            blocks: [
              {
                type: 'pair',
                title: 'Technical SEO',
                before: side('Before'),
                after: side('After'),
              },
            ],
          },
        ],
      }),
    );
    const at = (text: string) => drawn.texts.find((t) => t.text === text)!;
    expect(at('Before').y).toBe(at('After').y);
    expect(at('Before').x).toBeLessThan(at('After').x);
    expect(at('After').x).toBeGreaterThan(PAGE.width / 2);
    const values = drawn.texts.filter((t) => t.text === 'B');
    expect(values).toHaveLength(2);
    expect(values[0]!.y).toBe(values[1]!.y);
  });

  it('draws a table’s column names again on each page it runs onto, and each row once', () => {
    const rows = Array.from({ length: 200 }, (_, n) => [`row ${n}`, `value ${n}`]);
    const table = { type: 'table' as const, caption: 'Pages', columns: ['Page', 'Value'], rows };
    const drawn = draw(doc({ sections: [{ heading: 'A table', blocks: [table] }] }));
    expect(drawn.pages).toBeGreaterThan(2);
    const instances = expectDrawsTheDocument(
      doc({ sections: [{ heading: 'A table', blocks: [table] }] }),
      drawn,
    );
    const names = instances.filter((i) => i.text === 'Page');
    expect(names.map((i) => i.pages[0])).toEqual(
      Array.from({ length: drawn.pages }, (_, n) => n + 1),
    );
    expect(instances.filter((i) => i.text === 'Pages')).toHaveLength(1);
    for (const n of [0, 57, 199]) {
      expect(instances.filter((i) => i.text === `row ${n}`)).toHaveLength(1);
    }
    // On a page the table runs onto, the names come before that page's first row.
    const second = drawn.texts.filter((t) => t.page === 2 && t.source !== PAGE_NUMBER);
    const name = second.find((t) => t.text === 'Page')!;
    const firstRow = second.find((t) => t.text.startsWith('row '))!;
    expect(name.y).toBeLessThan(firstRow.y);
  });

  it('runs a cell taller than a page on to the next, whole', () => {
    const long = Array.from({ length: 3000 }, (_, n) => `w${n}`).join(' ');
    const d = doc({
      sections: [
        {
          heading: 'One cell',
          blocks: [{ type: 'table', caption: 'c', columns: ['a', 'b'], rows: [[long, 'short']] }],
        },
      ],
    });
    const drawn = draw(d);
    const cell = expectDrawsTheDocument(d, drawn).find((i) => i.text === long)!;
    expect(new Set(cell.pages).size).toBeGreaterThan(1);
  });

  it('marks each not-measured sentence, after a rule', () => {
    const d = doc({
      notMeasured: ['Text without JavaScript was not measured.', 'Tested 6 of 7 signals'],
    });
    const drawn = draw(d);
    expect(drawn.marks).toBe(2);
    expectDrawsTheDocument(d, drawn);
  });

  it('keeps each text inside the page, above the footer’s rule or in the footer', () => {
    const long = Array.from({ length: 4000 }, (_, n) => `word${n}`).join(' ');
    const drawn = draw(
      doc({ sections: [{ heading: 'Long', blocks: [{ type: 'text', text: long }] }] }),
    );
    expect(drawn.pages).toBeGreaterThan(3);
    for (const t of drawn.texts) {
      expect(t.x).toBeGreaterThanOrEqual(48);
      expect(t.x + measure(t.text, t.style)).toBeLessThanOrEqual(PAGE.width - 48 + 0.001);
      expect(t.y).toBeGreaterThan(48);
      expect(t.y).toBeLessThan(PAGE.height - 30);
    }
  });

  it('refuses a footer line that leaves a page no room for the document', () => {
    const footer = { text: Array.from({ length: 6000 }, () => 'word').join(' '), href: '' };
    expect(() => draw(doc({ footer }))).toThrow(/footer leaves no room/);
  });

  it('property: what is drawn is the document’s strings, each whole, and the pages’ numbers', () => {
    fc.assert(
      fc.property(anyDoc, (d) => {
        const drawn = draw(d);
        expectDrawsTheDocument(d, drawn);
        for (const t of drawn.texts) {
          expect(t.text).not.toMatch(/[\s\u0085\u0008]{2}|^[\s\u0085\u0008]|[\s\u0085\u0008]$/u);
          expect(t.y).toBeGreaterThan(0);
          expect(t.y).toBeLessThan(PAGE.height);
          // Inside the margins: a line ends by the right one unless it is one character too wide.
          expect(t.x).toBeGreaterThanOrEqual(48);
          const end = t.x + measure(t.text, t.style);
          expect(end <= PAGE.width - 48 + 0.001 || Array.from(t.text).length === 1).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});
