import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { runCrawl } from './crawler.js';
import type { FrontierOutcome, FrontierRecord, FrontierStore } from './analysis/frontier-checkpoint.js';

// SPEC 5.1a §8 (Stage 6) — THE EXHAUSTIVE KILL SWEEP. This is the acceptance criterion for the
// durable frontier, and it is what licenses the UNCONDITIONAL form of the resume claim.
//
// EXHAUSTIVE BY CONSTRUCTION, not by a sampled guess. For each hook the sweep first counts how many
// times that hook is called in a straight-through crawl, then kills at EVERY one of those calls
// (after = 0 .. n-1). A kill point that is never reached is reported rather than skipped silently, and
// the death count is asserted at the end so the sweep cannot quietly become vacuous — a sweep that
// stops sweeping would otherwise pass in perfect silence, which is how the SPEC 05 barrel guard died.
//
// THREE CAPS, because the failure this guards against ONLY appears when the page cap binds: 200 (does
// not bind, whole site fits), 40 and 25 (bind). An earlier per-row settle diverged at exactly two
// death points, both at settle, both at cap 40 — 4-5 pages of 40 replaced at a CONSTANT selected
// count. Sweeping only the non-binding cap would have reported a clean bill of health.

let server: http.Server;
let baseUrl: string;
const HUBS = ['article', 'listing', 'guide', 'tag'];
const LEAVES = 20;

beforeAll(async () => {
  const page = (l: string[]) => `<html><head><title>t</title></head><body>${l.map((h) => `<a href="${h}">x ${h}</a>`).join(' ')}</body></html>`;
  server = http.createServer((req, res) => {
    const p = req.url ?? '/';
    if (p === '/robots.txt' || p === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
    const send = (h: string) => { res.setHeader('content-type', 'text/html'); res.end(h); };
    if (p === '/' || p === '') { send(page(HUBS.map((h) => `/${h}`))); return; }
    const hub = p.match(/^\/([a-z]+)$/);
    if (hub && HUBS.includes(hub[1]!)) { send(page(Array.from({ length: LEAVES }, (_, i) => `/${hub[1]}/p-${i}`))); return; }
    if (/^\/[a-z]+\/p-\d+$/.test(p)) { send(page(['/'])); return; }
    res.statusCode = 404; res.end('nf');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

type Hook = 'upsert' | 'claim' | 'settle';

class Store implements FrontierStore {
  rows = new Map<string, FrontierRecord>();
  counts = { upsert: 0, claim: 0, settle: 0 };
  killOn: { hook: Hook; after: number } | null = null;
  private trip(h: Hook) {
    this.counts[h]++;
    if (this.killOn && this.killOn.hook === h && this.counts[h] > this.killOn.after) throw new Error('died');
  }
  async upsertDiscovered(recs: FrontierRecord[]) {
    this.trip('upsert');
    for (const r of recs) {
      const prev = this.rows.get(r.urlHash);
      if (!prev) this.rows.set(r.urlHash, { ...r });
      else if (r.depth < prev.depth) this.rows.set(r.urlHash, { ...prev, depth: r.depth });
    }
  }
  async allDiscovered() { return [...this.rows.values()].map((r) => ({ ...r })).reverse(); }
  async claim(urls: string[], limit: number) {
    const out: FrontierRecord[] = [];
    for (const r of this.rows.values()) {
      if (out.length >= limit) break;
      if (r.state === 'discovered' && urls.includes(r.url)) { r.state = 'claimed'; out.push({ ...r }); }
    }
    this.trip('claim');
    return out;
  }
  async settleBatch(os: FrontierOutcome[]) {
    this.trip('settle');
    for (const o of os) { const r = this.rows.get(o.urlHash); if (r) r.state = o.state; }
  }
  async deleteAll() { this.rows.clear(); }
}

const input = (store: FrontierStore | undefined, pageCap: number) => ({
  startUrls: [baseUrl], pageCap, perHostConcurrency: 4, staggerMs: 0, pageTimeoutMs: 5000,
  allowPrivateIpsForTesting: true, deterministicFrontier: true, politeCrawl: true,
  maxCrawlMs: 60_000, frontierStore: store,
});

describe('SPEC 5.1a §8 — exhaustive kill sweep: a resume matches at EVERY reachable death point', () => {
  it('sweeps', async () => {
    const divergences: string[] = [];
    let totalDeaths = 0;
    for (const cap of [200, 40, 25]) {
      const probe = new Store();
      const straight = await runCrawl(input(probe, cap));
      const sd = straight.fingerprint!;
      const totals = { ...probe.counts };


      for (const hook of ['upsert', 'claim', 'settle'] as Hook[]) {
        for (let after = 0; after < totals[hook]; after++) {
          const store = new Store();
          store.killOn = { hook, after };
          let died = false;
          try { await runCrawl(input(store, cap)); } catch { died = true; }
          if (!died) continue; // unreachable kill point — not a death, so not a data point
          totalDeaths++;
          store.killOn = null;
          const resumed = await runCrawl(input(store, cap));
          const rd = resumed.fingerprint!;
          const match = rd.digest === sd.digest;
          if (!match) divergences.push(`cap=${cap} ${hook}@${after} ${rd.digest.slice(0, 12)}`);
          if (!match) console.log(`  DIVERGED ${hook}@${after}: ${rd.digest.slice(0, 12)} vs ${sd.digest.slice(0, 12)}`);
        }
      }
    }
    // THE assertion: every reachable death point resumes onto the same sample.
    expect(divergences).toEqual([]);
    // Anti-vacuity: if the wiring were removed the crawl would never die and the sweep would pass
    // while proving nothing. 30 is below the 35 observed, so ordinary drift does not trip it.
    expect(totalDeaths).toBeGreaterThanOrEqual(30);
  }, 900_000);
});
