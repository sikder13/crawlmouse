import { describe, it, expect } from 'vitest';
import { buildPageRows, buildLinkRows, buildFindingRows } from './persist-helpers';

const PAGES = [
  { url: 'https://x.com/', urlHash: 'h0', title: 'Home', statusCode: 200, depth: 0, inDegree: 2, outDegree: 1, isOrphan: false },
  { url: 'https://x.com/a', urlHash: 'h1', title: null, statusCode: 200, depth: 1, inDegree: 1, outDegree: 0, isOrphan: false },
];

describe('buildPageRows', () => {
  it('maps engine pages to db rows tagged with the audit id', () => {
    const rows = buildPageRows('aud-1', PAGES);
    expect(rows[0]).toEqual({
      audit_id: 'aud-1', url: 'https://x.com/', url_hash: 'h0', title: 'Home',
      status_code: 200, depth: 0, in_degree: 2, out_degree: 1, is_orphan: false,
    });
  });
});

describe('buildLinkRows', () => {
  const map = new Map([['https://x.com/', 'p0'], ['https://x.com/a', 'p1']]);

  it('resolves both endpoints to page ids when present', () => {
    const rows = buildLinkRows('aud-1', [{ fromUrl: 'https://x.com/', toUrl: 'https://x.com/a', anchorText: 'A', isGenericAnchor: false }], map);
    expect(rows).toEqual([{ audit_id: 'aud-1', from_page_id: 'p0', to_page_id: 'p1', anchor_text: 'A', is_generic_anchor: false }]);
  });

  it('drops a link if either endpoint is missing from the page map', () => {
    // This is the exact corruption an incomplete (truncated) page map caused: links to
    // pages that fell out of the map were silently dropped. With a complete map, kept.
    const rows = buildLinkRows('aud-1', [
      { fromUrl: 'https://x.com/', toUrl: 'https://x.com/missing', anchorText: null, isGenericAnchor: false },
      { fromUrl: 'https://x.com/missing', toUrl: 'https://x.com/a', anchorText: null, isGenericAnchor: false },
    ], map);
    expect(rows).toEqual([]);
  });
});

describe('buildFindingRows', () => {
  const map = new Map([['https://x.com/a', 'p1']]);

  it('attaches page_id when the finding has a known page url', () => {
    const rows = buildFindingRows('aud-1', [{ category: 'orphan', severity: 'high', pageUrl: 'https://x.com/a', payload: { k: 1 } }], map);
    expect(rows[0]).toEqual({ audit_id: 'aud-1', category: 'orphan', severity: 'high', page_id: 'p1', payload: { k: 1 } });
  });

  it('sets page_id null for a site-level finding or an unmapped url', () => {
    const rows = buildFindingRows('aud-1', [
      { category: 'site', severity: 'low' },
      { category: 'x', severity: 'low', pageUrl: 'https://x.com/gone' },
    ], map);
    expect(rows.map((r) => r.page_id)).toEqual([null, null]);
    expect(rows[0]!.payload).toBeNull();
  });
});
