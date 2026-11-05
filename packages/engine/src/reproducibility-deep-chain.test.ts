import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { runAudit } from './audit.js';
import { MIN_COVERAGE_PAGES } from './constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// T6 (§5 politeness vs the 240s/300s budget), the deep-chain case, moved here unchanged from
// reproducibility.test.ts. It asserts a lower bound on work done inside a wall-clock budget (at
// least MIN_COVERAGE_PAGES pages from a chain whose pages each answer after 150 ms, inside 2 s),
// so it runs in the engine's serial run with the other timer-based fixtures, not beside the rest
// of the suite (docs/ops/ci-timing.md).
// ─────────────────────────────────────────────────────────────────────────────
describe('T6: politeness vs the 240s/300s budget (§5)', () => {
  it('certifies a budget-exhausted deep-chain crawl as low-confidence + caveated (high coverage is a mirage)', async () => {
    // A deep CHAIN: each page links ONLY to the next, so the crawl is serial and the un-crawled tail
    // is never DISCOVERED → coverage (fetchedOk/discovered) reads ~1.0 even though we saw a fraction of
    // the site. Without budget→low-confidence this would be graded a confident A–F on a partial crawl.
    const N = 80;
    const server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      if (path === '/robots.txt' || path === '/sitemap.xml') {
        res.statusCode = 404;
        res.end('');
        return;
      }
      const n =
        path === '/' || path === ''
          ? 0
          : /^\/(\d+)$/.exec(path)
            ? Number(/^\/(\d+)$/.exec(path)![1])
            : -1;
      if (n < 0) {
        res.statusCode = 404;
        res.end('');
        return;
      }
      res.on('error', () => {});
      setTimeout(() => {
        try {
          if (res.writableEnded) return;
          res.setHeader('content-type', 'text/html');
          res.end(
            n + 1 <= N
              ? `<html><head><title>${n}</title></head><body><a href="/${n + 1}">next</a></body></html>`
              : `<html><head><title>${n}</title></head><body>end</body></html>`,
          );
        } catch {
          /* socket torn down on budget exhaustion */
        }
      }, 150);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const result = await runAudit(
        { url: base, pageCap: 200, perHostConcurrency: 4, staggerMs: 0, pageTimeoutMs: 5000 },
        { allowPrivateIpsForTesting: true, engineV2: true, maxCrawlMsForTesting: 2000 },
      );

      // Enough pages to clear the thin-crawl floor, so budget exhaustion (not page count) is the thing
      // forcing low confidence; and not the whole chain (it's partial).
      const ok = result.pages.filter((p) => p.statusCode === 200).length;
      expect(ok).toBeGreaterThanOrEqual(MIN_COVERAGE_PAGES);
      expect(result.pages.length).toBeLessThan(N);

      // The trust contract (§2): a budget-cut partial crawl is low-confidence, partial, and caveated by
      // the band's estimate framing + the incomplete_crawl finding — never the old blunt score cap.
      expect(result.crawlHealth?.partial).toBe(true);
      expect(result.crawlHealth?.confidence).toBe('low');
      expect(result.findings.some((f) => f.category === 'incomplete_crawl')).toBe(true);
      // "High coverage is a mirage" is the claim, and it survives intact: the crawl is still marked
      // partial and low-confidence, and the incomplete_crawl finding still explains why. What no longer
      // survives is the band, because this fixture is refused — and a band exists to caveat a number
      // that was asserted. There is none to caveat.
      expect(result.confidenceBand, 'no band around a verdict we withheld').toBeUndefined();
      expect(result.score, 'a refused audit asserts no score').toBeNull();
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 30000);
});
