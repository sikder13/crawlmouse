import { describe, it, expect } from 'vitest';
import { buildPageRows, buildLinkRows, buildFindingRows, buildFixRows } from './persist-helpers';
import type { FixDiagnosis, FixPrescription } from '@crawlmouse/types';

const PAGES = [
  { url: 'https://x.com/', urlHash: 'h0', title: 'Home', statusCode: 200, depth: 0, inDegree: 2, outDegree: 1, isOrphan: false },
  { url: 'https://x.com/a', urlHash: 'h1', title: null, statusCode: 200, depth: 1, inDegree: 1, outDegree: 0, isOrphan: false },
];

describe('buildPageRows', () => {
  it('maps a legacy (v1) page to a db row with the additive columns at their safe defaults', () => {
    // The v1 engine path never sets fetchOutcome/excludedFromGrade, so the row must carry
    // fetch_outcome: null + excluded_from_grade: false — exactly the new columns' defaults, so
    // the persisted shape is unchanged for the v1 path / prod until the ENGINE_V2 flip.
    const rows = buildPageRows('aud-1', PAGES);
    expect(rows[0]).toEqual({
      audit_id: 'aud-1', url: 'https://x.com/', url_hash: 'h0', title: 'Home',
      status_code: 200, depth: 0, in_degree: 2, out_degree: 1, is_orphan: false,
      fetch_outcome: null, excluded_from_grade: false, pagerank: null,
    });
  });

  it('maps a v2 blocked/excluded page to fetch_outcome + excluded_from_grade', () => {
    const rows = buildPageRows('aud-1', [
      { url: 'https://x.com/b', urlHash: 'h2', title: null, statusCode: 403, depth: null, inDegree: 0, outDegree: 0, isOrphan: false, fetchOutcome: 'blocked', excludedFromGrade: true },
    ]);
    expect(rows[0]).toEqual({
      audit_id: 'aud-1', url: 'https://x.com/b', url_hash: 'h2', title: null,
      status_code: 403, depth: null, in_degree: 0, out_degree: 0, is_orphan: false,
      fetch_outcome: 'blocked', excluded_from_grade: true, pagerank: null,
    });
  });

  it('maps a v2 gradeable page pagerank to the pagerank column', () => {
    const rows = buildPageRows('aud-1', [
      { url: 'https://x.com/', urlHash: 'h0', title: 'Home', statusCode: 200, depth: 0, inDegree: 2, outDegree: 1, isOrphan: false, fetchOutcome: 'ok', excludedFromGrade: false, pagerank: 0.42 },
    ]);
    expect(rows[0]!.pagerank).toBe(0.42);
  });

  it('maps a v2 ok/gradeable page to fetch_outcome: ok + excluded_from_grade: false', () => {
    const rows = buildPageRows('aud-1', [
      { url: 'https://x.com/', urlHash: 'h0', title: 'Home', statusCode: 200, depth: 0, inDegree: 2, outDegree: 1, isOrphan: false, fetchOutcome: 'ok', excludedFromGrade: false },
    ]);
    expect(rows[0]!.fetch_outcome).toBe('ok');
    expect(rows[0]!.excluded_from_grade).toBe(false);
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

describe('buildFixRows (SPEC 02 ledger + cures → fixes rows)', () => {
  const ledger: FixDiagnosis[] = [
    { id: 'orphan:https://x.com/o', category: 'orphan', targetUrl: 'https://x.com/o', targetTitle: 'O', marginalDelta: 5, effort: 'low', rationale: 'no inbound' },
    { id: 'deep_page:https://x.com/d', category: 'deep_page', targetUrl: 'https://x.com/d', targetTitle: null, marginalDelta: 2, effort: 'medium', rationale: 'too deep' },
  ];
  const prescriptions: FixPrescription[] = [
    {
      fixId: 'orphan:https://x.com/o',
      suggestedLinks: [{ fromUrl: 'https://x.com/h', fromTitle: 'H', anchorText: 'o page', relevanceScore: 0.8 }],
      actionPacket: { fixId: 'orphan:https://x.com/o', format: 'markdown', body: 'PACKET O', copyLabel: 'Copy AI prompt' },
    },
  ];

  it('joins each diagnosis to its prescription, ranks by ledger order, marks the free fix', () => {
    const rows = buildFixRows('aud-1', ledger, prescriptions, 'orphan:https://x.com/o');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      audit_id: 'aud-1', fix_id: 'orphan:https://x.com/o', category: 'orphan',
      target_url: 'https://x.com/o', target_title: 'O', marginal_delta: 5, effort: 'low',
      rationale: 'no inbound', rank: 1, is_free_fix: true,
      suggested_links: prescriptions[0]!.suggestedLinks, action_packet_body: 'PACKET O',
    });
    // the 2nd diagnosis has NO prescription → gated cure columns null, not the free fix
    expect(rows[1]!.rank).toBe(2);
    expect(rows[1]!.is_free_fix).toBe(false);
    expect(rows[1]!.suggested_links).toBeNull();
    expect(rows[1]!.action_packet_body).toBeNull();
  });

  it('returns [] for an empty ledger (v1 / no projection)', () => {
    expect(buildFixRows('aud-1', [], [], null)).toEqual([]);
  });
});
