/**
 * The stream's budget at the 500-page cap (CC-22b D5), measured: what one stored batch result and
 * a whole check cost the stream route to read and send. `held_mib` is the heap a parsed batch
 * result holds, read after a collection on each side of the read.
 *
 * Two shapes. "typical" has the link and text volume of CC-20b's live run of a 500-page static site
 * (books.toscrape.com: 8,101 link edges, 11 crawl batches; notes/cc-20b/evidence-live-run.jsonl).
 * "heavy" gives each of the 500 pages the most served text a crawl row keeps (CRAWL_RAW_TEXT_BYTES)
 * and 100 links. The numbers are printed as one JSON line; the assertions hold the bounds the
 * route's code enforces to what was measured.
 */
import v8 from 'node:v8';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BatchResultSchema, CRAWL_RAW_TEXT_BYTES } from '@crawlmouse/types/v2';
import { serveStream, type StreamDeps } from '../../../app/api/checks/[id]/stream/serve';
import { gzipJson } from './evidence';
import { BATCH_GZIP_BYTES, BATCH_RAW_BYTES, START, batchEvents, readBatch } from './stream';
import { STARTED, crawlResult, edge, row } from './stream.fixtures';
import type { StreamSnapshot } from './stream-store';

const PAGES = 500;
const PER_BATCH = 50;
const CHECK_ID = '0b0e7a52-5f0b-4b53-9c0e-0d4a3a1f2c11';

const WORDS =
  'trail stove tent ridge map river camp boot rope lamp pack snow wind path gear dawn pine rock lake fire'.split(
    ' ',
  );
/** `chars` of words in an order a seed fixes, so it compresses as prose does and not as one letter. */
function prose(chars: number, seed: number): string {
  let s = seed >>> 0;
  let out = '';
  while (out.length < chars) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += `${WORDS[s % WORDS.length]}${s % 97} `;
  }
  return out.slice(0, chars);
}

function batchesOf(textChars: number, linksPerPage: number) {
  return Array.from({ length: PAGES / PER_BATCH }, (_, b) => {
    const pages = Array.from({ length: PER_BATCH }, (_, i) => {
      const n = b * PER_BATCH + i;
      return {
        ...row({ path: `/p/${n}`, at: n * 700, links: linksPerPage }),
        raw_text: prose(textChars, n + 1),
      };
    });
    const edges = pages.flatMap((_, i) =>
      Array.from({ length: linksPerPage }, (_, k) =>
        edge(`/p/${b * PER_BATCH + i}`, `/p/${(b * PER_BATCH + i * 7 + k * 13) % PAGES}`),
      ),
    );
    return crawlResult(pages, edges);
  });
}

v8.setFlagsFromString('--expose-gc');
const collect = vm.runInNewContext('gc') as () => void;
const heap = (): number => {
  collect();
  return process.memoryUsage().heapUsed;
};
const mib = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;

interface BatchCost {
  gzip: number;
  raw: number;
  readMs: number;
  heldBytes: number;
  events: number;
  eventBytes: number;
}

async function measure(name: string, textChars: number, linksPerPage: number) {
  const results = batchesOf(textChars, linksPerPage);
  const objects = results.map((r) => gzipJson(r));
  const paths = objects.map((_, i) => `anon/s/c/batch-${i + 1}.json.gz`);
  const evidence = { get: async (path: string) => objects[paths.indexOf(path)]! };

  // One batch at a time, as the route reads them.
  const perBatch: BatchCost[] = [];
  let cursor = START;
  for (let i = 0; i < objects.length; i++) {
    const before = heap();
    const t0 = performance.now();
    const result = await readBatch(evidence, paths[i]!);
    const readMs = performance.now() - t0;
    const held = heap();
    const out = batchEvents(cursor, { batch: i + 1, result }, STARTED);
    cursor = out.cursor;
    perBatch.push({
      gzip: objects[i]!.byteLength,
      raw: gunzipSync(objects[i]!).byteLength,
      readMs,
      heldBytes: held - before,
      events: out.events.length,
      eventBytes: out.events.reduce((n, e) => n + JSON.stringify(e).length, 0),
    });
  }

  // The full replay: a viewer who opens the stream once every batch is stored.
  const snapshot: StreamSnapshot = {
    siteId: 's',
    accountId: null,
    siteRemoved: false,
    status: 'failed',
    progress: null,
    startedAt: new Date(STARTED).toISOString(),
    finishedAt: new Date(STARTED + 480_000).toISOString(),
    expiresAt: null,
    batches: results.map((r, i) => ({
      batch: i + 1,
      kind: 'crawl',
      status: 'done',
      resultPath: paths[i]!,
      pages: r.pages.length,
      links: r.link_edges.length,
    })),
  };
  const deps: StreamDeps = {
    read: {
      rows: async (table) =>
        table === 'checks'
          ? [{ id: CHECK_ID, site_id: 's', status: 'failed', trigger: 'first_audit' }]
          : [{ id: 's', host: 'stream.test', account_id: null, removed_at: null }],
    },
    isMember: async () => false,
    store: {
      snapshot: async () => snapshot,
      scores: async () => ({ seo: null, aiReadability: null, withheld: false }),
    },
    evidence,
    limits: { streamOpens: async () => true, finishedOnce: async () => true },
    captureFinished: async () => undefined,
    clientIp: () => 'budget',
    now: () => STARTED + 600_000,
    sleep: async () => undefined,
  };
  const t0 = performance.now();
  const res = await serveStream(
    new Request('https://x.test/stream'),
    CHECK_ID,
    { userId: null },
    deps,
  );
  const body = await res.text();
  const replayMs = performance.now() - t0;

  const max = (pick: (b: BatchCost) => number) => Math.max(...perBatch.map(pick));
  const sum = (pick: (b: BatchCost) => number) => perBatch.reduce((n, b) => n + pick(b), 0);
  return {
    shape: name,
    pages: PAGES,
    batches: perBatch.length,
    link_edges: results.reduce((n, r) => n + r.link_edges.length, 0),
    per_batch_max: {
      gzip_mib: mib(max((b) => b.gzip)),
      raw_mib: mib(max((b) => b.raw)),
      read_ms: Math.round(max((b) => b.readMs)),
      held_mib: mib(max((b) => b.heldBytes)),
      events: max((b) => b.events),
      event_kib: Math.round(max((b) => b.eventBytes) / 1024),
    },
    whole_check: {
      gzip_mib: mib(sum((b) => b.gzip)),
      raw_mib: mib(sum((b) => b.raw)),
      read_ms: Math.round(sum((b) => b.readMs)),
      events: sum((b) => b.events),
    },
    full_replay: {
      wall_ms: Math.round(replayMs),
      sent_kib: Math.round(body.length / 1024),
      status: res.status,
    },
  };
}

describe('the stream at the 500-page cap', () => {
  it('reads a typical and a heavy check inside the bounds the route enforces', async () => {
    // Both shapes are contract batch results, so what is measured is what the pipeline stores.
    const sample = batchesOf(CRAWL_RAW_TEXT_BYTES, 100)[0]!;
    expect(BatchResultSchema.safeParse(sample).success).toBe(true);

    const typical = await measure('typical', 3000, 16);
    const heavy = await measure('heavy', CRAWL_RAW_TEXT_BYTES, 100);
    console.log(`STREAM_BUDGET ${JSON.stringify({ typical, heavy })}`);

    for (const m of [typical, heavy]) {
      // Each batch is inside both size bounds with at least half of each to spare, so the bound
      // passes over an object the pipeline would not write, not one it does.
      expect(m.per_batch_max.gzip_mib).toBeLessThan(mib(BATCH_GZIP_BYTES) / 2);
      expect(m.per_batch_max.raw_mib).toBeLessThan(mib(BATCH_RAW_BYTES) / 2);
      // The replay drew each page: the stream ends with the end, after 500 page_fetched events.
      expect(m.full_replay.status).toBe(200);
      expect(m.whole_check.events).toBeGreaterThanOrEqual(PAGES);
    }
    // Time, held loosely: a full replay of the heavy check is far inside the stream's 240 s.
    expect(heavy.full_replay.wall_ms).toBeLessThan(30_000);
  }, 120_000);
});
