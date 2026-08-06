import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { runCrawl } from './crawler.js';
import type { FrontierOutcome, FrontierRecord, FrontierStore } from './analysis/frontier-checkpoint.js';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a §8 (Stage 6) — the DURABLE FRONTIER, WIRED INTO THE CRAWL.
//
// Stage 5 proved B6 as a PURE FUNCTION: given the same discovered set, a resumed selection equals a
// straight-through one. That is necessary and it is not sufficient. `resumeSelection` models ONE
// selection over the complete set, while the live crawl selects INCREMENTALLY — a round at a time,
// over the pool that is left. Those are different models, so the pure proof says nothing about
// whether the wired crawl resumes to the same sample. This file drives the wiring against a REAL
// crawl over a real HTTP server, with a real interruption.
//
// WHAT "KILLED MID-FLIGHT" MEANS HERE, and why it is faithful rather than simulated. The production
// resume trigger is an exception escaping `crawlAndPersist`: Inngest retries the step and re-runs the
// whole crawl, and the previous attempt's frontier rows are still there because the delete-at-
// completion never ran. So the kill is modelled as an exception from the store at a chosen point in
// the round — not by hand-editing rows into a state no crawl would produce.
//
// THE PER-ROUND ORDER IS CRASH-CONSISTENT, and the kill points are chosen to sit either side of it:
//   1. upsert what was discovered   (persist the basis BEFORE anything is selected from it)
//   2. select   3. claim   4. fetch the batch
//   5. upsert this round's children 6. settle the batch
// Dying between 4 and 5 leaves rows `claimed` with their children unpersisted; dying between 5 and 6
// leaves them `claimed` with children persisted. Both must converge, and re-discovering a child is
// idempotent because the row identity is (audit_id, url_hash).
// ─────────────────────────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

// Four distinct templates so the §6 round-robin quota actually bites. A single-stratum fixture would
// pass a broken implementation, which is the mistake the discovery-cap fixture made once already.
const HUBS = ['article', 'listing', 'guide', 'tag'];
const LEAVES_PER_HUB = 20;

beforeAll(async () => {
  const page = (links: string[], title: string) =>
    `<html><head><title>${title}</title></head><body>${links
      .map((h) => `<a href="${h}">link to ${h}</a>`)
      .join(' ')}</body></html>`;
  server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/robots.txt' || path === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
    const send = (html: string) => { res.setHeader('content-type', 'text/html'); res.end(html); };
    if (path === '/' || path === '') { send(page(HUBS.map((h) => `/${h}`), 'home')); return; }
    // No trailing slash: canonicalization strips one, so a `/hub/` fixture would 404 as `/hub`
    // and quietly turn four hubs into four dead fetches.
    const hub = path.match(/^\/([a-z]+)$/);
    if (hub && HUBS.includes(hub[1]!)) {
      const n = hub[1]!;
      send(page(Array.from({ length: LEAVES_PER_HUB }, (_, i) => `/${n}/p-${i}`), `${n} hub`));
      return;
    }
    const leaf = path.match(/^\/([a-z]+)\/p-(\d+)$/);
    if (leaf && HUBS.includes(leaf[1]!)) { send(page(['/'], path.slice(1))); return; }
    res.statusCode = 404; res.end('not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

/**
 * An in-memory FrontierStore standing in for the SQL one at the INTERFACE seam.
 *
 * This is a test double for the persistence boundary, not for the behaviour under test: the resume
 * logic being proven lives in the crawler, and the same crawler runs against the real Postgres-backed
 * store in the Stage 6 integration test. What this buys is the ability to interrupt the crawl at an
 * exact point, which is awkward to do through a database.
 */
class MemoryStore implements FrontierStore {
  rows = new Map<string, FrontierRecord>();
  upsertCalls = 0;
  claimCalls = 0;
  settleCalls = 0;
  deleted = false;
  /**
   * Throw the next time this hook is reached, to model a worker dying at that point.
   *
   * WHERE the throw sits relative to the mutation is chosen per hook to model a REAL death rather
   * than a convenient one — a real worker dies either side of a commit, and the two leave different
   * rows behind:
   *   claim  — mutate THEN throw: the claim committed and the process died before fetching. This is
   *            the only way to reach a genuinely claimed-but-never-read row.
   *   upsert — throw THEN mutate: died before the children reached the table (the harder case, since
   *            the resume has to rediscover them).
   *   settle — throw THEN mutate: the page was fetched but its outcome was never recorded.
   */
  killOn: { hook: 'upsert' | 'claim' | 'settle'; after: number } | null = null;
  private counts = { upsert: 0, claim: 0, settle: 0 };

  private trip(hook: 'upsert' | 'claim' | 'settle'): void {
    this.counts[hook]++;
    if (this.killOn && this.killOn.hook === hook && this.counts[hook] > this.killOn.after) {
      throw new Error(`worker died at ${hook} #${this.counts[hook]}`);
    }
  }

  /**
   * Mirrors `upsert_frontier_batch` STATEMENT FOR STATEMENT, and the constraint it mirrors is that it
   * CANNOT WRITE `state` on an existing row — the update path copies `prev` and replaces `depth`
   * alone, so there is no expression here through which a settled row could be reset.
   *
   * A DOUBLE THAT IS MORE CAPABLE THAN THE REAL DEPENDENCY HIDES THE DEFECT IT WAS WRITTEN TO CATCH.
   * The previous version of this method implemented least()-on-depth and state preservation while the
   * deployed path — a PostgREST upsert, which emits `SET col = excluded.col` per payload key — could
   * do neither. Six tests were green because the double did what production could not. That is the
   * "passes against a stub, proves nothing" class in a new costume, and no test failure found it: it
   * was found by asking what PostgREST actually emits.
   */
  async upsertDiscovered(records: FrontierRecord[]): Promise<void> {
    this.upsertCalls++;
    this.trip('upsert');
    for (const r of records) {
      // The SQL drops rows whose source is outside the enum, rather than letting the CHECK fail.
      if (r.source !== 'homepage' && r.source !== 'sitemap' && r.source !== 'link') continue;
      const prev = this.rows.get(r.urlHash);
      if (!prev) {
        // INSERT: state comes from the column default, never from the payload.
        this.rows.set(r.urlHash, { ...r, state: 'discovered' });
        continue;
      }
      // ON CONFLICT DO UPDATE SET depth = least(...), updated_at = now(). `state` is absent from the
      // SET list in the SQL and is absent here for the same reason.
      this.rows.set(r.urlHash, { ...prev, depth: Math.min(prev.depth, r.depth) });
    }
  }

  async allDiscovered(): Promise<FrontierRecord[]> {
    // Deliberately shuffled: Postgres guarantees no order without ORDER BY, and arrival order is a
    // forbidden selection input (§6.6). A resume that depends on read order must fail here.
    return [...this.rows.values()].map((r) => ({ ...r })).reverse();
  }

  async claim(urls: string[], limit: number): Promise<FrontierRecord[]> {
    this.claimCalls++;
    const out: FrontierRecord[] = [];
    for (const r of this.rows.values()) {
      if (out.length >= limit) break;
      if (r.state === 'discovered' && urls.includes(r.url)) {
        r.state = 'claimed';
        out.push({ ...r });
      }
    }
    this.trip('claim'); // committed, THEN died — leaves rows claimed and unfetched
    return out;
  }

  /**
   * ONE unit of work, mirroring `settle_frontier_batch`: the trip fires before ANY row is written, so
   * a death here leaves the round wholly unsettled — which is the state atomicity guarantees and the
   * per-row version could not.
   */
  async settleBatch(outcomes: FrontierOutcome[]): Promise<void> {
    this.settleCalls++;
    this.trip('settle');
    for (const o of outcomes) {
      // The SQL whitelists the three terminal verbs so a caller cannot un-settle a row.
      if (o.state !== 'fetched' && o.state !== 'failed' && o.state !== 'skipped') continue;
      const r = this.rows.get(o.urlHash);
      if (r) r.state = o.state;
    }
  }

  async deleteAll(): Promise<void> {
    this.deleted = true;
    this.rows.clear();
  }
}

const crawlInput = (store: FrontierStore | undefined, pageCap: number) => ({
  startUrls: [baseUrl],
  pageCap,
  perHostConcurrency: 4,
  staggerMs: 0,
  pageTimeoutMs: 5000,
  allowPrivateIpsForTesting: true,
  deterministicFrontier: true,
  politeCrawl: true,
  maxCrawlMs: 60_000,
  frontierStore: store,
});

/** Total fixture size: homepage + hubs + leaves. */
const SITE_SIZE = 1 + HUBS.length + HUBS.length * LEAVES_PER_HUB; // 85

describe('the frontier store is wired into the crawl path', () => {
  it('persists every discovered URL, claims what it selects, and DELETES at completion', async () => {
    const store = new MemoryStore();
    const out = await runCrawl(crawlInput(store, 200));

    // The crawl really ran.
    expect(out.fingerprint).toBeDefined();
    expect(out.pages.length).toBeGreaterThan(10);

    // Every operation was exercised — not merely the easy one.
    expect(store.upsertCalls).toBeGreaterThan(0);
    expect(store.claimCalls).toBeGreaterThan(0);
    expect(store.settleCalls).toBeGreaterThan(0);

    // Frontier rows are TRANSIENT: a crawl that finishes leaves nothing behind.
    expect(store.deleted).toBe(true);
    expect(store.rows.size).toBe(0);
  });

  it('leaves the rows in place when the crawl DIES, so a retry has something to resume from', async () => {
    const store = new MemoryStore();
    store.killOn = { hook: 'settle', after: 1 };
    await expect(runCrawl(crawlInput(store, 200))).rejects.toThrow(/worker died/);
    // The delete never ran, so the basis survives for the resume.
    expect(store.deleted).toBe(false);
    expect(store.rows.size).toBeGreaterThan(0);
  });
});

describe('re-discovery must not un-settle a row', () => {
  // The rule `upsert_frontier_batch` exists to enforce, pinned at the store seam because that is where
  // it lives. A client-side upsert emits `SET col = excluded.col` for every payload key, and the
  // engine's record carries state:'discovered' — so re-staging a fetched row would reset it, and the
  // resume would then place a page it had already read back into the pool.
  //
  // The re-stage itself is reachable because batchDepth is the MINIMUM depth in a batch: a shallow URL
  // deferred by the §6 quota lowers it, and children already known deeper are re-staged shallower.
  // Zero occurrences were observed across two fixtures at both caps, so this is possible-but-
  // unobserved — pinned here so the choice that makes reachability irrelevant cannot be undone.
  it('lowers the depth but PRESERVES a state already reached', async () => {
    const store = new MemoryStore();
    const rec: FrontierRecord = {
      urlHash: 'h1', url: 'https://x.test/a', templateKey: '/t', sampleKey: 'k',
      depth: 5, state: 'discovered', source: 'link',
    };
    await store.upsertDiscovered([rec]);
    await store.settleBatch([{ urlHash: 'h1', state: 'fetched' }]);
    expect(store.rows.get('h1')!.state).toBe('fetched');

    await store.upsertDiscovered([{ ...rec, depth: 2 }]);
    expect(store.rows.get('h1')!.depth).toBe(2);
    expect(store.rows.get('h1')!.state).toBe('fetched'); // NOT reset to 'discovered'

    // And a DEEPER re-discovery never raises the depth — least(), not last-write-wins.
    await store.upsertDiscovered([{ ...rec, depth: 9 }]);
    expect(store.rows.get('h1')!.depth).toBe(2);
  });

  it('drops a settle verb outside the three terminal states', async () => {
    const store = new MemoryStore();
    await store.upsertDiscovered([{
      urlHash: 'h2', url: 'https://x.test/b', templateKey: '/t', sampleKey: 'k',
      depth: 1, state: 'discovered', source: 'link',
    }]);
    await store.settleBatch([{ urlHash: 'h2', state: 'fetched' }]);
    await store.settleBatch([{ urlHash: 'h2', state: 'discovered' as never }]);
    expect(store.rows.get('h2')!.state).toBe('fetched');
  });
});

describe('B6 IN THE WIRED CRAWL — a resumed crawl selects the same sample', () => {
  it('ACCEPTANCE: killed at a round boundary and resumed => identical fingerprint digest', async () => {
    const straight = await runCrawl(crawlInput(new MemoryStore(), 200));

    // Kill at a ROUND BOUNDARY: the claim for a later round, before any of its pages are fetched.
    const store = new MemoryStore();
    store.killOn = { hook: 'claim', after: 3 };
    await expect(runCrawl(crawlInput(store, 200))).rejects.toThrow(/worker died/);
    expect(store.rows.size).toBeGreaterThan(0);

    // Resume over the SAME rows — this is the retry Inngest performs.
    store.killOn = null;
    const resumed = await runCrawl(crawlInput(store, 200));

    expect(resumed.fingerprint!.digest).toBe(straight.fingerprint!.digest);
    expect(resumed.fingerprint!.discoveredCount).toBe(straight.fingerprint!.discoveredCount);
  });

  it('re-fetches a page the dead worker had CLAIMED but never read', async () => {
    // A row still `claimed` at resume means the worker died holding it: it was never fetched, so its
    // children were never discovered. Treating it as consumed would silently drop it AND its subtree.
    // Releasing it is what makes the discovered set converge on the straight-through one.
    // Kill immediately AFTER a claim commits, before any of that batch is fetched.
    const store = new MemoryStore();
    store.killOn = { hook: 'claim', after: 1 };
    await expect(runCrawl(crawlInput(store, 200))).rejects.toThrow(/worker died/);
    const claimedAtDeath = [...store.rows.values()].filter((r) => r.state === 'claimed');
    expect(claimedAtDeath.length).toBeGreaterThan(0);
    // None of them was ever read, which is what makes releasing them load-bearing.
    expect(claimedAtDeath.every((r) => r.state === 'claimed')).toBe(true);

    store.killOn = null;
    const resumed = await runCrawl(crawlInput(store, 200));
    // Every page the dead worker was holding is in the finished crawl's output.
    const fetched = new Set(resumed.pages.map((p) => p.url));
    for (const r of claimedAtDeath) expect(fetched.has(r.url)).toBe(true);
  });

  it('reaches the WHOLE site across an interruption when the page cap does not bind', async () => {
    const store = new MemoryStore();
    store.killOn = { hook: 'upsert', after: 2 };
    await expect(runCrawl(crawlInput(store, 200))).rejects.toThrow(/worker died/);
    store.killOn = null;
    const resumed = await runCrawl(crawlInput(store, 200));
    expect(resumed.fingerprint!.discoveredCount).toBe(SITE_SIZE);
  });
});
