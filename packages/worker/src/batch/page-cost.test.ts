import fc from 'fast-check';
import { LinkEdgeSchema, type Hreflang, type LinkEdge } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { EDGE_OVERHEAD, pageCost } from './crawl.js';

/** A string's bytes in the stored JSON, without its quotes: what pageCost must charge for it. */
const stored = (s: string) => Buffer.byteLength(JSON.stringify(s)) - 2;

const CHECK_ID = '00000000-0000-4000-8000-000000000001';
/** An edge's fields as pageCost reads them; the schema's URL rules do not bear on what it charges. */
const edge = (from_url: string, to_url: string, anchor_text: string): LinkEdge => ({
  check_id: CHECK_ID,
  from_url,
  to_url,
  anchor_text,
  is_generic_anchor: false,
  js_only: false,
});
const alt = (hreflang: string, href: string): Hreflang['links'][number] => ({ hreflang, href });

describe('pageCost', () => {
  const quotes = '"'.repeat(1000);

  it('charges each counted string at its JSON size, a page of quotes at twice its UTF-8 size', () => {
    expect(pageCost(quotes, null, [], [])).toBe(2000);
    expect(pageCost('', null, [edge('', '', quotes)], [])).toBe(2000 + EDGE_OVERHEAD);
    expect(pageCost('', null, [edge(quotes, '', '')], [])).toBe(2000 + EDGE_OVERHEAD);
    expect(pageCost('', null, [edge('', quotes, '')], [])).toBe(2000 + EDGE_OVERHEAD);
    expect(pageCost('', null, [], [alt(quotes, '')])).toBe(2000);
    expect(pageCost('', null, [], [alt('', quotes)])).toBe(2000);
  });

  it('charges content features as their JSON', () => {
    const features = { headings: [quotes], json_ld: { '@type': 'Product' } };
    expect(pageCost('', features, [], [])).toBe(Buffer.byteLength(JSON.stringify(features)));
  });

  it('adds every counted string at its JSON size, whatever the strings hold (property)', () => {
    const text = fc.string({ unit: 'binary', maxLength: 40 });
    fc.assert(
      fc.property(
        text,
        fc.array(fc.tuple(text, text, text), { maxLength: 5 }),
        fc.array(fc.tuple(text, text), { maxLength: 5 }),
        (raw, edges, alts) => {
          const want =
            stored(raw) +
            edges.reduce(
              (n, [a, b, c]) => n + stored(a) + stored(b) + stored(c) + EDGE_OVERHEAD,
              0,
            ) +
            alts.reduce((n, [a, b]) => n + stored(a) + stored(b), 0);
          expect(
            pageCost(
              raw,
              null,
              edges.map(([a, b, c]) => edge(a, b, c)),
              alts.map(([a, b]) => alt(a, b)),
            ),
          ).toBe(want);
        },
      ),
      { numRuns: 300 },
    );
  });

  // EDGE_OVERHEAD predates CC-42B and is kept so that ordinary batches are cut where they were. It is
  // below an edge's real JSON shell: pinned here, so the gap the comments describe is measured.
  it('charges an edge 9 bytes less than its JSON beyond its three strings', () => {
    // A real edge, as the schema accepts it, less its three strings: the keys and other fields.
    const shell = (flag: boolean) => {
      const [from, to, anchor] = ['https://a.example/', 'https://a.example/b', 'b'];
      const e = LinkEdgeSchema.parse({
        check_id: CHECK_ID,
        from_url: from,
        to_url: to,
        anchor_text: anchor,
        is_generic_anchor: flag,
        js_only: flag,
      });
      const one =
        Buffer.byteLength(JSON.stringify([e, e])) - Buffer.byteLength(JSON.stringify([e]));
      return one - stored(from) - stored(to) - stored(anchor);
    };
    expect(shell(false)).toBe(137);
    expect(shell(true)).toBe(135);
    expect(shell(false) - EDGE_OVERHEAD).toBe(9);
  });
});
