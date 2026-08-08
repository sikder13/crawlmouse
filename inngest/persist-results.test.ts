import { describe, it, expect } from 'vitest';
import { persistAuditResults } from './persist-results';

/**
 * Minimal stateful fake of the supabase-js query builder: tracks rows per table,
 * assigns ids to inserted pages (as the DB would), and can be told to fail one
 * table's insert. Enough to prove idempotency on retry and fail-loud on error.
 */
function makeFakeSb(opts: { failInsert?: string; auditStatus?: string } = {}) {
  const tables: Record<string, Record<string, unknown>[]> = {
    pages: [], links: [], findings: [], fixes: [], audits: [{ id: 'aud-1', status: opts.auditStatus ?? 'crawling' }],
  };
  let pageSeq = 0;
  const client = {
    from(table: string) {
      return {
        insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
          if (opts.failInsert === table) return Promise.resolve({ error: { message: `boom:${table}` } });
          const arr = Array.isArray(rows) ? rows : [rows];
          for (const r of arr) tables[table]!.push(table === 'pages' ? { ...r, id: `pid-${pageSeq++}` } : { ...r });
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            eq(_col: string, val: unknown) {
              if (table !== 'audits') tables[table] = tables[table]!.filter((r) => r.audit_id !== val);
              return Promise.resolve({ error: null });
            },
          };
        },
        select() {
          return {
            eq(_col: string, val: unknown) {
              return {
                range(from: number, to: number) {
                  const all = tables[table]!.filter((r) => r.audit_id === val);
                  return Promise.resolve({ data: all.slice(from, to + 1), error: null });
                },
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          // Support chained .eq() filters (e.g. .eq('id', x).eq('status', 'crawling')); apply the
          // patch only to audit rows matching ALL filters. Each node is chainable (.eq) AND awaitable
          // (.then), so `await update().eq(...).eq(...)` resolves after the last filter.
          const filters: [string, unknown][] = [];
          const node = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return node;
            },
            then(resolve: (v: { error: null }) => void) {
              if (table === 'audits') {
                tables.audits = tables.audits!.map((a) =>
                  filters.every(([c, v]) => a[c] === v) ? { ...a, ...patch } : a,
                );
              }
              resolve({ error: null });
            },
          };
          return node;
        },
      };
    },
  };
  return { client, tables };
}

const RESULT = {
  cms: 'shopify', cmsMetadata: {}, score: 88, grade: 'A', completedAt: '2026-06-01T00:00:00.000Z',
  pages: [
    { url: 'https://x.com/', urlHash: 'h0', title: 'Home', statusCode: 200, depth: 0, inDegree: 1, outDegree: 1, isOrphan: false },
    { url: 'https://x.com/a', urlHash: 'h1', title: null, statusCode: 200, depth: 1, inDegree: 1, outDegree: 0, isOrphan: false },
  ],
  links: [{ fromUrl: 'https://x.com/', toUrl: 'https://x.com/a', anchorText: 'A', isGenericAnchor: false }],
  findings: [{ category: 'orphan', severity: 'low', pageUrl: 'https://x.com/a', payload: { k: 1 } }],
};

// A v2 result carries §6 crawl-health; persistence must write it to the additive audits columns.
const RESULT_V2 = {
  ...RESULT,
  crawlHealth: { discovered: 10, fetchedOk: 8, blocked: 1, coveragePct: 0.8, blockRate: 0.1, partial: true, confidence: 'medium' },
};

// A full conversion-core result (SPEC 02): band + projected grade on audits, ledger + cures → fixes.
const RESULT_CONVERSION = {
  ...RESULT_V2,
  confidenceBand: { pointEstimate: 88, grade: 'A', lower: 86, upper: 90, confidence: 'medium', basis: { crawled: 8, estimatedTotal: 10, method: 'frontier' }, isEstimate: true },
  projectedGrade: {
    current: { score: 88, grade: 'A' },
    projected: { score: 93.5, grade: 'A' },
    ledger: [
      { id: 'orphan:https://x.com/a', category: 'orphan', targetUrl: 'https://x.com/a', targetTitle: 'A', marginalDelta: 5, effort: 'low', rationale: 'no inbound' },
    ],
    disclaimer: 'Estimated, not guaranteed.',
  },
  prescriptions: [
    { fixId: 'orphan:https://x.com/a', suggestedLinks: [{ fromUrl: 'https://x.com/', fromTitle: 'Home', anchorText: 'a page', relevanceScore: 0.9 }], actionPacket: { fixId: 'orphan:https://x.com/a', format: 'markdown', body: 'PACKET A', copyLabel: 'Copy AI prompt' } },
  ],
  freeFix: { diagnosis: { id: 'orphan:https://x.com/a', category: 'orphan', targetUrl: 'https://x.com/a', targetTitle: 'A', marginalDelta: 5, effort: 'low', rationale: 'no inbound' }, prescription: { fixId: 'orphan:https://x.com/a', suggestedLinks: [], actionPacket: { fixId: 'orphan:https://x.com/a', format: 'markdown', body: 'PACKET A', copyLabel: 'Copy AI prompt' } }, rank: 1 },
};

// SPEC 5.1a Stage 4: a REFUSED audit — no letter, no score, but full evidence about what was read.
const RESULT_REFUSED = {
  ...RESULT_V2,
  grade: null,
  score: null,
  refusal: { refused: true, triggers: ['site_too_small_to_measure'], gradeableCount: 2, floor: 5 },
  coverage: {
    fetched: 4, gradeable: 2, estimatedTotal: 4, estimateSource: 'frontier', coverageRatio: 1,
    exclusions: { archive: 1, tag: 1 },
  },
  fingerprint: {
    version: 1, discoveredCount: 4, selectedCount: 4, digest: 'abc123', seed: 'seed-x',
    strata: [{ templateKey: '/a', discovered: 2, selected: 2 }, { templateKey: '/b', discovered: 2, selected: 2 }],
  },
};

describe('persistAuditResults', () => {
  it('inserts pages, links, findings then marks the audit completed last', async () => {
    const { client, tables } = makeFakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistAuditResults(client as any, 'aud-1', RESULT);
    expect(tables.pages).toHaveLength(2);
    expect(tables.links).toHaveLength(1);
    expect(tables.findings).toHaveLength(1);
    expect(tables.audits![0]!.status).toBe('completed');
    expect(tables.audits![0]!.grade).toBe('A');
  });

  it('is idempotent: a retry does NOT duplicate children (links/findings have no unique key)', async () => {
    const { client, tables } = makeFakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistAuditResults(client as any, 'aud-1', RESULT);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistAuditResults(client as any, 'aud-1', RESULT); // simulate Inngest re-running the step
    expect(tables.pages).toHaveLength(2);
    expect(tables.links).toHaveLength(1);
    expect(tables.findings).toHaveLength(1);
  });

  it('throws on an insert error and leaves the audit NOT completed (so the step retries)', async () => {
    const { client, tables } = makeFakeSb({ failInsert: 'findings' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(persistAuditResults(client as any, 'aud-1', RESULT)).rejects.toThrow(/findings/);
    expect(tables.audits![0]!.status).toBe('crawling'); // never flipped to completed
  });

  it('does NOT complete a CANCELED audit — a crawl finishing right after a user-cancel can never un-cancel', async () => {
    const { client, tables } = makeFakeSb({ auditStatus: 'canceled' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistAuditResults(client as any, 'aud-1', RESULT);
    expect(tables.audits![0]!.status).toBe('canceled'); // guard: completion writes only when status='crawling'
  });

  it('writes the §6 crawl-health columns when the v2 engine provides crawlHealth', async () => {
    const { client, tables } = makeFakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistAuditResults(client as any, 'aud-1', RESULT_V2);
    const audit = tables.audits![0]!;
    expect(audit.discovered_count).toBe(10);
    expect(audit.fetched_ok_count).toBe(8);
    expect(audit.blocked_count).toBe(1);
    expect(audit.coverage_pct).toBe(0.8);
    expect(audit.block_rate).toBe(0.1);
    expect(audit.confidence).toBe('medium');
    expect(audit.partial).toBe(true);
    expect(audit.status).toBe('completed'); // still completes normally
  });

  // ── SPEC 5.1a Stage 4 — refusal / coverage / fingerprint ──────────────────────────────────────
  //
  // ADDED AFTER A SURVIVING MUTATION. Deleting all three spreads from the completion update passed
  // 141/141 inngest tests: the write that the entire user-facing refusal chain depends on, and the
  // sole reason migration 20260804000001 exists, was asserted by nothing. That is this branch's own
  // recorded lesson — exhaustive coverage of the wrong assertion is not coverage — recurring one file
  // over, in code that DOES execute in production.
  it('writes the Stage-4 refusal, coverage and fingerprint columns when the engine provides them', async () => {
    const { client, tables } = makeFakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistAuditResults(client as any, 'aud-1', RESULT_REFUSED as any);
    const audit = tables.audits![0]!;
    expect(audit.refusal).toEqual({ refused: true, triggers: ['site_too_small_to_measure'], gradeableCount: 2, floor: 5 });
    expect(audit.coverage).toEqual(RESULT_REFUSED.coverage);
    expect(audit.fingerprint).toMatchObject({ version: 1, discoveredCount: 4, selectedCount: 4, seed: 'seed-x' });
    expect(audit.status).toBe('completed');
  });

  it('persists a WITHHELD verdict as NULL — a refused audit is completed, not failed, and carries no letter', async () => {
    // The bytes that reach the row are what every downstream surface reads. A refused audit must
    // complete normally with grade/score null; anything else turns an absence into an F.
    const { client, tables } = makeFakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistAuditResults(client as any, 'aud-1', RESULT_REFUSED as any);
    const audit = tables.audits![0]!;
    expect(audit.grade).toBeNull();
    expect(audit.score).toBeNull();
    expect(audit.status).toBe('completed');
    expect(JSON.stringify(audit)).not.toContain('"grade":"F"');
  });

  it('BOUNDS the fingerprint at the write — the strata table is otherwise unbounded', async () => {
    // The strata table tracks the PRE-SELECTION discovered count (measured max 100 684 on one live
    // audit), so an unbounded write is megabytes of jsonb on a single row.
    const { client, tables } = makeFakeSb();
    const huge = {
      ...RESULT_REFUSED,
      fingerprint: {
        version: 1, discoveredCount: 5000, selectedCount: 500, digest: 'd', seed: 'seed-x',
        strata: Array.from({ length: 5000 }, (_, i) => ({ templateKey: `/t${i}`, discovered: 1, selected: 1 })),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistAuditResults(client as any, 'aud-1', huge as any);
    const fp = tables.audits![0]!.fingerprint as { strata: unknown[]; strataWithheld?: number; digest: string };
    expect(fp.strata.length).toBeLessThanOrEqual(100);
    expect(fp.strataWithheld).toBeGreaterThan(0);
    expect(fp.digest).toBe('d'); // the digest is never touched by the bound
  });

  it('omits all three Stage-4 columns when the engine does not provide them (v1 path unchanged)', async () => {
    const { client, tables } = makeFakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistAuditResults(client as any, 'aud-1', RESULT);
    const audit = tables.audits![0]!;
    expect('refusal' in audit).toBe(false);
    expect('coverage' in audit).toBe(false);
    expect('fingerprint' in audit).toBe(false);
  });

  it('omits the crawl-health columns entirely on the v1 path (no crawlHealth) — prod byte-unchanged', async () => {
    const { client, tables } = makeFakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistAuditResults(client as any, 'aud-1', RESULT);
    const audit = tables.audits![0]!;
    expect(audit.status).toBe('completed');
    // None of the crawl-health keys are present in the update patch on the v1 path.
    expect('discovered_count' in audit).toBe(false);
    expect('coverage_pct' in audit).toBe(false);
    expect('confidence' in audit).toBe(false);
    expect('partial' in audit).toBe(false);
    // ...nor any conversion-core columns/rows.
    expect('confidence_band' in audit).toBe(false);
    expect('projected_score' in audit).toBe(false);
    expect(tables.fixes).toHaveLength(0);
  });

  it('persists the confidence band + projected grade on audits and the ledger/cures into fixes (v2)', async () => {
    const { client, tables } = makeFakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistAuditResults(client as any, 'aud-1', RESULT_CONVERSION as any);
    const audit = tables.audits![0]!;
    expect(audit.status).toBe('completed');
    expect(audit.projected_score).toBe(93.5);
    expect(audit.projected_grade).toBe('A');
    expect((audit.confidence_band as { grade: string }).grade).toBe('A');
    // ledger + cure persisted; the free fix flagged; the gated cure body present in the row
    expect(tables.fixes).toHaveLength(1);
    const fix = tables.fixes![0]!;
    expect(fix.fix_id).toBe('orphan:https://x.com/a');
    expect(fix.is_free_fix).toBe(true);
    expect(fix.action_packet_body).toBe('PACKET A');
  });

  it('clears prior fixes on a retry (idempotent — no duplicate cures)', async () => {
    const { client, tables } = makeFakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistAuditResults(client as any, 'aud-1', RESULT_CONVERSION as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistAuditResults(client as any, 'aud-1', RESULT_CONVERSION as any);
    expect(tables.fixes).toHaveLength(1);
  });
});

// ── SPEC 05 C3 — the bound must be WIRED, not merely available ───────────────────────────────────
// boundAiReadinessForPersist has its own unit tests, but deleting the call from this write path left
// every one of them green. A helper nobody calls fixes nothing, so this drives the REAL persist path
// and asserts on the bytes that actually reach the audits row.
describe('persistAuditResults — audits.ai_readiness is bounded at the write', () => {
  const bigScore = (n: number, titleLen: number) => ({
    score: 55, band: 'partial' as const,
    components: {
      access: { score: 1, weight: 25 as const }, contentWithoutJs: { score: 0.5, weight: 40 as const },
      machineLegibility: { score: 0.6, weight: 20 as const }, retrievalPath: { score: 0.5, weight: 15 as const },
    },
    confidence: 'high' as const, isEstimate: false,
    basis: { pagesAnalyzed: 2000, siteJsRendered: false, retrievalPathBasis: 'full' as const },
    findings: Array.from({ length: n }, (_, i) => ({
      id: `f${i}`, kind: 'missing_structured_data' as const, severity: 'info' as const,
      targetUrl: `https://x.com/p${i}`, targetTitle: 'T'.repeat(titleLen),
      plainLanguage: 'PLAIN', evidence: 'contested' as const,
    })),
    totalFindings: n,
    accessMatrix: { bots: [], robotsTxtFound: true, wafDetected: false, wafNote: null },
    llmsTxt: { present: false, parseable: false, note: 'n/a' },
    asOf: '2026-07-01',
  });

  it('writes a BOUNDED ledger with an honest pre-cap total (6002 findings at PRO_PAGE_CAP scale)', async () => {
    const { client, tables } = makeFakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistAuditResults(client as any, 'aud-1', { ...RESULT_V2, aiReadiness: bigScore(6002, 60) } as any);
    const written = tables.audits![0]!.ai_readiness as { findings: unknown[]; totalFindings: number };
    expect(written.findings.length).toBeLessThan(6002);
    expect(written.totalFindings).toBe(6002);
  });

  it('the SERIALIZED row stays bounded when titles are attacker-long (measured 31.54 MB unbounded)', async () => {
    const { client, tables } = makeFakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistAuditResults(client as any, 'aud-1', { ...RESULT_V2, aiReadiness: bigScore(6002, 5000) } as any);
    expect(Buffer.byteLength(JSON.stringify(tables.audits![0]!.ai_readiness), 'utf8')).toBeLessThan(3_000_000);
  });

  it('a small ledger is written through unchanged (the cap is a ceiling, never a rewrite)', async () => {
    const small = bigScore(3, 20);
    const { client, tables } = makeFakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistAuditResults(client as any, 'aud-1', { ...RESULT_V2, aiReadiness: small } as any);
    expect(tables.audits![0]!.ai_readiness).toEqual(small);
  });
});

// ── The chunked `pages` insert (round-4) — size, loop, and error propagation ─────────────────────
// All three shipped untested: `RESULT` has 2 pages, so the loop never ran twice, and the only
// insert-failure case targets `findings`. A chunk loop nobody exercises is a chunk loop that can be
// deleted, resized to infinity, or made to swallow errors with the suite still green.
describe('persistAuditResults — pages insert chunking', () => {
  const manyPages = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      url: `https://x.com/p${i}`, urlHash: `h${i}`, title: `T${i}`,
      statusCode: 200, depth: 1, inDegree: 1, outDegree: 0, isOrphan: false,
    }));

  it('inserts EVERY row exactly once across chunks, preserving order', async () => {
    const { client, tables } = makeFakeSb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistAuditResults(client as any, 'aud-1', { ...RESULT, pages: manyPages(1001), links: [], findings: [] } as any);
    expect(tables.pages).toHaveLength(1001);
    const urls = tables.pages!.map((r) => r.url);
    expect(new Set(urls).size).toBe(1001);
    expect(urls[0]).toBe('https://x.com/p0');
    expect(urls[1000]).toBe('https://x.com/p1000');
  });

  it('issues MULTIPLE requests — one un-chunked body is what this exists to prevent', async () => {
    // Pins the loop itself: with the chunking removed this is a single call, and with the chunk size
    // raised to infinity it is also a single call. Measured 29.67 MB for one body at PRO_PAGE_CAP.
    let insertCalls = 0;
    const { client, tables } = makeFakeSb();
    const realFrom = client.from.bind(client);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).from = (t: string) => {
      const node = realFrom(t);
      if (t !== 'pages') return node;
      const realInsert = node.insert.bind(node);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      node.insert = (rows: any) => { insertCalls += 1; return realInsert(rows); };
      return node;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistAuditResults(client as any, 'aud-1', { ...RESULT, pages: manyPages(1001), links: [], findings: [] } as any);
    expect(insertCalls).toBeGreaterThan(1);
    expect(tables.pages).toHaveLength(1001);
  });

  it('PROPAGATES a chunk failure — a swallowed error would complete an audit with missing pages', async () => {
    const { client } = makeFakeSb({ failInsert: 'pages' });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      persistAuditResults(client as any, 'aud-1', { ...RESULT, pages: manyPages(600), links: [], findings: [] } as any),
    ).rejects.toThrow(/pages insert failed/);
  });
});
