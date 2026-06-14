import { describe, it, expect } from 'vitest';
import { persistAuditResults } from './persist-results';

/**
 * Minimal stateful fake of the supabase-js query builder: tracks rows per table,
 * assigns ids to inserted pages (as the DB would), and can be told to fail one
 * table's insert. Enough to prove idempotency on retry and fail-loud on error.
 */
function makeFakeSb(opts: { failInsert?: string; auditStatus?: string } = {}) {
  const tables: Record<string, Record<string, unknown>[]> = {
    pages: [], links: [], findings: [], audits: [{ id: 'aud-1', status: opts.auditStatus ?? 'crawling' }],
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
});
