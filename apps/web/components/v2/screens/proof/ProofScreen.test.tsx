import fc from 'fast-check';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PREVIEWS } from '../../../../app/(v2-preview)/v2-preview/_preview/registry';
import {
  PROOF_PREVIEWS,
  proofPreview,
  type ProofPreview,
} from '../../../../app/(v2-preview)/v2-preview/_preview/proof';
import { CC31_PROOF_ELEMENTS } from '../../../../__tests__/v2/_lib/screens';
import { PROOF_COPY, PROOF_LABELS } from '../../../../lib/v2/copy/proof';
import {
  docStrings,
  type DocBlock,
  type DocSide,
  type ReportDoc,
} from '../../../../lib/v2/reports/generate';
import { proofView } from '../../../../lib/v2/view/proof';
import { ProofScreen } from './ProofScreen';

// The proof page (CC-31 D6b): it shows what its document holds and adds nothing. The rendered
// markup is parsed with jsdom, so a "text" below is a text node as a browser would build it.

const render = (doc: ReportDoc) => renderToStaticMarkup(<ProofScreen data={proofView(doc)} />);

function textNodes(html: string): string[] {
  const { document, NodeFilter } = new JSDOM(`<!doctype html><body>${html}</body>`).window;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const out: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n.nodeValue ?? '');
  return out;
}

/** A string as an HTML parser hands it back: a carriage return reads as a line feed. */
const parsed = (s: string) => s.replace(/\r\n?/g, '\n');

const text = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.string({ unit: 'grapheme', maxLength: 20 }),
  fc.constantFrom('', ' ', '<b>bold</b>', '&amp;', '"quoted"', 'A', '97', 'Before', '\r\n'),
);
const side: fc.Arbitrary<DocSide> = fc.record({
  label: text,
  date: text,
  value: text,
  evidence: fc.array(text, { maxLength: 3 }),
});
const block: fc.Arbitrary<DocBlock> = fc.oneof(
  fc.record({ type: fc.constant('text' as const), text }),
  fc.record({
    type: fc.constant('facts' as const),
    rows: fc.array(fc.record({ label: text, value: text }), { maxLength: 3 }),
  }),
  fc.record({
    type: fc.constant('table' as const),
    caption: text,
    columns: fc.array(text, { maxLength: 4 }),
    rows: fc.array(fc.array(text, { maxLength: 5 }), { maxLength: 3 }),
  }),
  fc.record({ type: fc.constant('pair' as const), title: text, before: side, after: side }),
);
const docs: fc.Arbitrary<ReportDoc> = fc.record({
  title: text,
  lines: fc.array(text, { maxLength: 3 }),
  sections: fc.array(fc.record({ heading: text, blocks: fc.array(block, { maxLength: 4 }) }), {
    maxLength: 3,
  }),
  notMeasured: fc.array(text, { maxLength: 3 }),
  footer: fc.record({
    text,
    href: fc.constantFrom('https://crawlmouse.com/', 'javascript:alert(1)', '', '/x'),
  }),
});

/** How many times each string occurs. */
function counts(strings: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of strings) m.set(s, (m.get(s) ?? 0) + 1);
  return m;
}

describe('the proof page shows its document and nothing else', () => {
  it('every text node is a string of the document, or one of the page’s three labels', () => {
    fc.assert(
      fc.property(docs, (doc) => {
        const allowed = new Set([...docStrings(doc).map(parsed), ...PROOF_LABELS]);
        for (const node of textNodes(render(doc))) {
          expect(allowed.has(node), JSON.stringify(node)).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('every string of the document that is not empty is on the page, as often as the document holds it', () => {
    fc.assert(
      fc.property(docs, (doc) => {
        const drawn = counts(textNodes(render(doc)));
        // The footer's address is the link's target, not text.
        const held = docStrings(doc).slice(0, -1).map(parsed);
        for (const [s, n] of counts(held.filter((x) => x !== ''))) {
          expect(drawn.get(s) ?? 0, JSON.stringify(s)).toBeGreaterThanOrEqual(n);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('the property test’s reader sees a literal the component would add (anti-vacuity)', () => {
    expect(textNodes('<main><p>Grade A</p><span> </span><i>x &amp; y</i></main>')).toEqual([
      'Grade A',
      ' ',
      'x & y',
    ]);
  });

  it('a string that looks like markup is text, not an element', () => {
    const html = render({
      title: '<img src=x onerror=alert(1)>',
      lines: [],
      sections: [],
      notMeasured: [],
      footer: { text: 'f', href: 'https://crawlmouse.com/' },
    });
    expect(html).not.toContain('<img');
    expect(textNodes(html)).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('the proof page’s layout', () => {
  const doc: ReportDoc = {
    title: 'T',
    lines: ['site', 'when'],
    sections: [
      {
        heading: 'H',
        blocks: [
          {
            type: 'pair',
            title: 'P',
            before: { label: 'Earlier', date: 'd1', value: 'v1', evidence: ['e1'] },
            after: { label: '', date: 'd2', value: 'v2', evidence: [] },
          },
          { type: 'table', caption: '', columns: ['c1'], rows: [['a', 'b'], []] },
        ],
      },
    ],
    notMeasured: ['n1'],
    footer: { text: 'Checked with Crawlmouse · Fri 30 Oct', href: 'https://crawlmouse.com/' },
  };
  const html = render(doc);

  it('draws a pair as two sides in document order, each with its own date, value and evidence', () => {
    const sides = [...html.matchAll(/<div[^>]*data-v2-proof-side=""[^>]*>(.*?)<\/div>/g)].map((m) =>
      textNodes(m[1]!),
    );
    expect(sides).toEqual([
      ['Earlier', 'd1', 'v1', 'e1'],
      [PROOF_COPY.after, 'd2', 'v2'],
    ]);
  });

  it('heads the not-measured list with the page’s label, and leaves the section out when the list is empty', () => {
    expect(html).toMatch(/<h2[^>]*>Not measured<\/h2><ul[^>]*><li>n1<\/li><\/ul>/);
    expect(render({ ...doc, notMeasured: [] })).not.toContain(PROOF_COPY.notMeasured);
  });

  it('keeps every cell of a row longer than its header, and names the table by its section', () => {
    expect(html).toMatch(/<table[^>]*aria-label="H"/);
    expect(textNodes(html.slice(html.indexOf('<table'), html.indexOf('</table>')))).toEqual([
      'c1',
      'a',
      'b',
    ]);
    expect(html.match(/<th /g)).toHaveLength(2);
  });

  it('ends with the document’s one line, linking the address the document gives', () => {
    expect(html).toMatch(
      /<footer[^>]*><a href="https:\/\/crawlmouse\.com\/">Checked with Crawlmouse · Fri 30 Oct<\/a><\/footer>/,
    );
  });

  it('links nothing for an address that is not https', () => {
    for (const href of [
      'javascript:alert(1)',
      'http://crawlmouse.com/',
      '/x',
      '',
      'data:text/html,x',
    ]) {
      const out = render({ ...doc, footer: { text: 'f', href } });
      expect(out, href).not.toContain('<a ');
      expect(out).toMatch(/<footer[^>]*><span>f<\/span><\/footer>/);
    }
  });

  it('has no action: no form, button, input or orange element, and one link', () => {
    expect(html).not.toMatch(/<form|<button|<input|<select|data-v2-primary/);
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it('has one h1, the title', () => {
    expect(html.match(/<h1[^>]*>(.*?)<\/h1>/g)).toEqual([expect.stringContaining('>T</h1>')]);
  });
});

describe('the previews', () => {
  const entries = PREVIEWS.filter((p) => /\/screens\/proof(\/|$)/.test(p.path));

  it('has an element and a page’s document for each preview the registry lists, each with no orange element', () => {
    expect(Object.keys(CC31_PROOF_ELEMENTS).sort()).toEqual(entries.map((p) => p.path).sort());
    expect(Object.keys(PROOF_PREVIEWS).sort()).toEqual(entries.map((p) => p.path).sort());
    expect(entries).toHaveLength(3);
    for (const e of entries) {
      expect(e.orange).toBe(0);
      expect(renderToStaticMarkup(CC31_PROOF_ELEMENTS[e.path]!())).not.toContain('data-v2-primary');
    }
  });

  it.each(Object.keys(PROOF_PREVIEWS) as ProofPreview[])(
    '%s shows its document’s strings and the footer line',
    (path) => {
      const doc = PROOF_PREVIEWS[path];
      const nodes = textNodes(renderToStaticMarkup(<ProofScreen data={proofPreview(path)} />));
      const allowed = new Set([...docStrings(doc), ...PROOF_LABELS]);
      expect(nodes.filter((n) => !allowed.has(n))).toEqual([]);
      expect(nodes.at(-1)).toMatch(/^Checked with Crawlmouse · /);
    },
  );

  it('the compare shows two pairs, the fix one, and the baseline none with its not-measured list', () => {
    const sides = (path: ProofPreview) =>
      (renderToStaticMarkup(CC31_PROOF_ELEMENTS[path]!()).match(/data-v2-proof-side/g) ?? [])
        .length;
    expect(sides('/v2-preview/screens/proof')).toBe(4);
    expect(sides('/v2-preview/screens/proof/fix')).toBe(2);
    expect(sides('/v2-preview/screens/proof/baseline')).toBe(0);
    expect(
      renderToStaticMarkup(CC31_PROOF_ELEMENTS['/v2-preview/screens/proof/baseline']!()),
    ).toContain(PROOF_COPY.notMeasured);
  });
});
