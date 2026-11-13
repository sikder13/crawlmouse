import { describe, expect, it } from 'vitest';
import type { ReportDoc } from './generate';
import { parseStoredDoc } from './share-doc';

const DOC: ReportDoc = {
  title: 't',
  lines: ['l'],
  sections: [
    {
      heading: 'h',
      blocks: [
        { type: 'text', text: 'p' },
        { type: 'facts', rows: [{ label: 'fl', value: 'fv' }] },
        { type: 'table', caption: 'c', columns: ['c1'], rows: [['a']] },
        {
          type: 'pair',
          title: 'pt',
          before: { label: 'bl', date: 'bd', value: 'bv', evidence: ['be'] },
          after: { label: 'al', date: 'ad', value: 'av', evidence: [] },
        },
      ],
    },
  ],
  notMeasured: ['n'],
  footer: { text: 'f', href: 'https://crawlmouse.com/' },
};

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

describe('parseStoredDoc', () => {
  it('reads back a document as it was stored', () => {
    expect(parseStoredDoc(bytes(DOC))).toEqual(DOC);
  });

  it('is null for bytes that are not JSON, not UTF-8, or not a document', () => {
    for (const bad of [
      new TextEncoder().encode('<html>'),
      new Uint8Array([0xff, 0xfe, 0x00]),
      bytes(null),
      bytes([DOC]),
      bytes({ ...DOC, title: 1 }),
      bytes({ ...DOC, footer: { text: 'f' } }),
      bytes({ ...DOC, sections: [{ heading: 'h', blocks: [{ type: 'html', html: '<b>' }] }] }),
    ]) {
      expect(parseStoredDoc(bad)).toBeNull();
    }
  });

  it('refuses a key the document does not have, at each level', () => {
    const [section] = DOC.sections;
    for (const bad of [
      { ...DOC, extra: 'x' },
      { ...DOC, footer: { ...DOC.footer, extra: 'x' } },
      { ...DOC, sections: [{ ...section!, extra: 'x' }] },
      { ...DOC, sections: [{ heading: 'h', blocks: [{ type: 'text', text: 'p', extra: 'x' }] }] },
    ]) {
      expect(parseStoredDoc(bytes(bad))).toBeNull();
    }
  });
});
