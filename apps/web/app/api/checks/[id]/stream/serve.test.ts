import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { recordedBuild } from '../../../../../../../packages/engine/fixtures/v2/build/recorded';
import { buildCheck } from '@crawlmouse/engine/v2/pipeline';
import type { BatchResult, CrawlPage } from '@crawlmouse/types/v2';
import { doorDb, signUp } from '../../../../../__tests__/v2/_lib/door-pglite';
import { pageVantage, persistBuiltCheck } from '../../../../../lib/v2/pipeline/persist';
import { checkRef } from '../../../../../lib/v2/pipeline/public';
import { BATCH_GZIP_BYTES } from '../../../../../lib/v2/pipeline/stream';
import { crawlResult, edge, row, urlOf } from '../../../../../lib/v2/pipeline/stream.fixtures';
import {
  pglitePersistDb,
  seedRunningCheck,
} from '../../../../../lib/v2/pipeline/test-support/pglite';
import { INITIAL_STATE, reduce, type ProgressEvent } from '../../../../../lib/v2/progress';
import type { Viewer } from '../../../../../lib/v2/pipeline/public';
import {
  NOW,
  groupsOf,
  harness,
  keep,
  queued,
  request,
  running,
  storeBatch,
  type Harness,
  type Ids,
} from '../../../../../__tests__/v2/_lib/check-routes-harness';
import { STREAM_OPENS_PER_IP_PER_HOUR } from '../_lib/limit-keys';
import { BATCH_READ_ATTEMPTS, POLL_MS, STREAM_CLOSE_MS, serveStream } from './serve';

const anonymous: Viewer = { userId: null };
const one = crawlResult(
  [row({ path: '/', at: 400 }), row({ path: '/a', at: 900 })],
  [edge('/', '/a'), edge('/a', '/')],
);
const two = crawlResult([row({ path: '/b', at: 40_000 })], [edge('/b', '/')]);

let db: PGlite;
let owner: string;
let stranger: string;
beforeAll(async () => {
  db = await doorDb();
  owner = await signUp(db, 'owner@example.com');
  stranger = await signUp(db, 'stranger@example.com');
}, 120_000);

const open = (h: Harness, ids: Ids, viewer = anonymous, lastId?: string) =>
  serveStream(
    request(`/api/checks/${ids.checkId}/stream`, {
      headers: lastId === undefined ? {} : { 'last-event-id': lastId },
    }),
    ids.checkId,
    viewer,
    h.deps,
  );

const typesOf = (events: ProgressEvent[]) =>
  events.map((e) => (e.type === 'stage' ? `${e.phase}:${e.state}` : e.type));
const fold = (events: ProgressEvent[]) => events.reduce(reduce, INITIAL_STATE);
const cancelled = (h: Harness, ids: Ids) => () => h.pipeline.fail(ids.checkId, 'canceled', null);

describe('the stream of a check anyone with its id may read', () => {
  it('sends the stored batch, the stages and the counts, then the end when the check ends', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'one.example');
    await storeBatch(h, ids, 1, one, { pages: 2, links: 2 });
    h.betweenPolls.push(cancelled(h, ids));

    const res = await open(h, ids);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const { groups, retry, loose } = groupsOf(await res.text());
    expect(retry).toBe(2000);
    expect(loose).toBe(0);
    expect(groups.map((g) => typesOf(g.events))).toEqual([
      ['page_fetched', 'page_linked', 'page_fetched', 'page_linked'],
      [
        'robots_and_sitemap:now',
        'robots_and_sitemap:done',
        'homepage:now',
        'homepage:done',
        'crawl:now',
        'counts',
      ],
      ['ended'],
    ]);
    const state = fold(groups.flatMap((g) => g.events));
    expect(state.nodes.map((n) => n.url)).toEqual([urlOf('/'), urlOf('/a')]);
    expect([state.pages_crawled, state.links_found, state.ended]).toEqual([2, 2, 'failed']);
    expect(h.gets).toHaveLength(1);
  });

  it('captures check_finished once, by the check ref, with what the row holds', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'finished-event.example');
    await storeBatch(h, ids, 1, one, { pages: 2, links: 2 });
    h.betweenPolls.push(cancelled(h, ids));
    const first = groupsOf(await (await open(h, ids)).text());
    // A second viewer, and the first reconnecting after the end.
    await (await open(h, ids)).text();
    await (await open(h, ids, anonymous, first.groups.at(-1)!.id!)).text();

    expect(h.captured).toHaveLength(1);
    const body = h.captured[0]!;
    expect(body.event).toBe('check_finished');
    expect(body.properties).toMatchObject({
      trigger: 'first_audit',
      status: 'failed',
      pages: 2,
      check_ref: checkRef(ids.checkId),
    });
    expect(typeof body.properties.durationMs).toBe('number');
    expect(JSON.stringify(body)).not.toContain(ids.checkId);
    expect(h.limits.join(' ')).not.toContain(ids.checkId);
    expect(h.limits.filter((k) => k.startsWith('event:check_finished:'))).toHaveLength(2);
  });

  it('check_finished carries the row’s page count, whatever counts the Last-Event-ID names', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'forged-cursor.example');
    await storeBatch(h, ids, 1, one, { pages: 2, links: 2 });
    await h.pipeline.fail(ids.checkId, 'canceled', null);
    // A cursor that fits the check (batch 0, not ended) and names counts the check never had.
    const res = await open(h, ids, anonymous, '1.0.0.999999999.999999999.0.0');
    expect(res.status).toBe(200);
    await res.text();
    expect(h.captured.map((c) => [c.event, c.properties.pages])).toEqual([['check_finished', 2]]);
  });

  it('sends nothing to PostHog for a visitor whose consent is required', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'consent.example');
    h.betweenPolls.push(cancelled(h, ids));
    const req = request(`/api/checks/${ids.checkId}/stream`, {
      headers: { cookie: 'cm_consent_required=1' },
    });
    const body = await (await serveStream(req, ids.checkId, anonymous, h.deps)).text();
    expect(groupsOf(body).groups.at(-1)!.events.at(-1)!.type).toBe('ended');
    expect(h.captured).toEqual([]);
  });

  it('reads a full replay one batch at a time, in batch order', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'replay.example');
    const paths = [
      await storeBatch(h, ids, 1, one, { pages: 2, links: 2 }),
      await storeBatch(h, ids, 2, two, { pages: 3, links: 3 }),
      await storeBatch(h, ids, 3, crawlResult([row({ path: '/c', at: 50_000 })], []), {
        pages: 4,
        links: 3,
      }),
    ];
    h.betweenPolls.push(cancelled(h, ids));
    const { groups } = groupsOf(await (await open(h, ids)).text());
    expect(h.gets).toEqual(paths);
    expect(h.mostAtOnce()).toBe(1);
    expect(fold(groups.flatMap((g) => g.events)).nodes).toHaveLength(4);
  });

  it('passes over a batch result over the size bound, and still sends the counts', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'oversize.example');
    await storeBatch(h, ids, 1, one, { pages: 2, links: 2 }, new Uint8Array(BATCH_GZIP_BYTES + 1));
    await storeBatch(h, ids, 2, two, { pages: 3, links: 3 });
    h.betweenPolls.push(cancelled(h, ids));
    const { groups } = groupsOf(await (await open(h, ids)).text());
    const state = fold(groups.flatMap((g) => g.events));
    expect(state.nodes.map((n) => n.url)).toEqual([urlOf('/b')]);
    expect(state.pages_crawled).toBe(3);
  });

  it('a batch read that fails once is read again on the same connection', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'flaky-read.example');
    await storeBatch(h, ids, 1, one, { pages: 2, links: 2 });
    await storeBatch(h, ids, 2, two, { pages: 3, links: 3 });
    const get = h.deps.evidence.get;
    let failures = 1;
    h.deps.evidence = {
      async get(path) {
        if (path.endsWith('batch-2.json.gz') && failures-- > 0) throw new Error('storage: reset');
        return get(path);
      },
    };
    h.betweenPolls.push(async () => undefined, cancelled(h, ids));
    const { groups } = groupsOf(await (await open(h, ids)).text());
    const all = groups.flatMap((g) => g.events);
    expect(fold(all).nodes.map((n) => n.url)).toEqual([urlOf('/'), urlOf('/a'), urlOf('/b')]);
    expect(all.at(-1)!.type).toBe('ended');
  });

  it('a batch whose read keeps failing is passed over after BATCH_READ_ATTEMPTS, and the rest goes on', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = harness(db);
    const ids = await running(db, h, 'lost-object.example');
    await storeBatch(h, ids, 1, one, { pages: 2, links: 2 });
    await storeBatch(h, ids, 2, two, { pages: 3, links: 3 });
    const get = h.deps.evidence.get;
    let tries = 0;
    h.deps.evidence = {
      async get(path) {
        if (path.endsWith('batch-2.json.gz')) {
          tries += 1;
          throw new Error('storage: object not found');
        }
        return get(path);
      },
    };
    h.betweenPolls.push(
      async () => undefined,
      async () => undefined,
      cancelled(h, ids),
    );
    const { groups } = groupsOf(await (await open(h, ids)).text());
    const all = groups.flatMap((g) => g.events);
    expect(tries).toBe(BATCH_READ_ATTEMPTS);
    // Batch 1's pages are drawn, batch 2's are not, and the check's counts and end still arrive.
    expect(fold(all).nodes.map((n) => n.url)).toEqual([urlOf('/'), urlOf('/a')]);
    expect(fold(all).pages_crawled).toBe(3);
    expect(all.at(-1)!.type).toBe('ended');
    // The cursor is past the batch, so a later connection does not try it again.
    expect(groups.at(-1)!.id).toMatch(/^1\.2\./);
    expect(warned.mock.calls).toEqual([
      [`[api/checks/stream] batch 2 was not read in ${BATCH_READ_ATTEMPTS} tries; passed over`],
    ]);
    warned.mockRestore();
  });

  it('for a client that has gone: no further batch object is read, and no `check_finished` is sent', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'client-gone.example');
    await storeBatch(h, ids, 1, one, { pages: 2, links: 2 });
    await storeBatch(h, ids, 2, two, { pages: 3, links: 3 });
    // The check has ended, so a poll that ran to its end would send the end and capture the event.
    await h.pipeline.fail(ids.checkId, 'canceled', null);
    const gone = new AbortController();
    const get = h.deps.evidence.get;
    const read: string[] = [];
    h.deps.evidence = {
      async get(path) {
        read.push(path);
        // The client drops the connection while the first batch's object is being read.
        gone.abort();
        return get(path);
      },
    };
    const res = await serveStream(
      request(`/api/checks/${ids.checkId}/stream`, { signal: gone.signal }),
      ids.checkId,
      anonymous,
      h.deps,
    );
    await res.text().catch(() => undefined);
    expect(read).toHaveLength(1);
    expect(read[0]).toMatch(/batch-1\.json\.gz$/);
    expect(h.captured).toEqual([]);
    expect(h.limits.filter((key) => key.startsWith('event:check_finished:'))).toEqual([]);
  });

  it('a queued check: nothing but the end when it is cancelled before it starts', async () => {
    const h = harness(db);
    const ids = await queued(db, 'queued.example');
    h.betweenPolls.push(async () => undefined, cancelled(h, ids));
    const { groups } = groupsOf(await (await open(h, ids)).text());
    expect(groups.map((g) => typesOf(g.events))).toEqual([['ended']]);
  });

  it('closes itself before the function limit, without an end, after polling every POLL_MS', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'long.example');
    await db.query(`update public.checks set expires_at = null where id = $1`, [ids.checkId]);
    const body = await (await open(h, ids)).text();
    expect(typesOf(groupsOf(body).groups.flatMap((g) => g.events))).not.toContain('ended');
    expect(h.clock.now - NOW).toBe(STREAM_CLOSE_MS);
    // The read at the open, and one after each wait.
    expect(h.snapshots()).toBe(1 + STREAM_CLOSE_MS / POLL_MS);
    expect(STREAM_CLOSE_MS).toBeLessThan(300_000);
    // An idle poll writes a comment line, so the connection is not silent for the four minutes.
    expect(body.split(':\n\n').length - 1).toBeGreaterThan(100);
  });
});

describe('resuming with Last-Event-ID', () => {
  it('sends what came after the cursor and nothing before it', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'resume.example');
    await db.query(`update public.checks set expires_at = null where id = $1`, [ids.checkId]);
    await storeBatch(h, ids, 1, one, { pages: 2, links: 2 });
    const first = groupsOf(await (await open(h, ids)).text());
    const lastId = first.groups.at(-1)!.id!;

    await storeBatch(h, ids, 2, two, { pages: 3, links: 3 });
    h.betweenPolls.push(cancelled(h, ids));
    const second = groupsOf(await (await open(h, ids, anonymous, lastId)).text());
    expect(second.groups.map((g) => typesOf(g.events))).toEqual([
      ['page_fetched', 'page_linked'],
      ['counts'],
      ['ended'],
    ]);
    const all = [...first.groups, ...second.groups].flatMap((g) => g.events);
    expect(fold(all).nodes.map((n) => n.url)).toEqual([urlOf('/'), urlOf('/a'), urlOf('/b')]);
    // Batch 1 was read by the first connection only.
    expect(h.gets.filter((p) => p.endsWith('batch-1.json.gz'))).toHaveLength(1);

    const third = groupsOf(await (await open(h, ids, anonymous, second.groups.at(-1)!.id!)).text());
    expect(third.groups.map((g) => typesOf(g.events))).toEqual([['ended']]);
    expect(third.groups[0]!.id).toBe(second.groups.at(-1)!.id);
  });

  it('answers 400 to an id that is not a cursor, or not this check’s', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'bad-cursor.example');
    await storeBatch(h, ids, 1, one, { pages: 2, links: 2 });
    for (const bad of ['nonsense', '1.9.5.2.2.100.0', '1.1.5.2.2.100.1']) {
      const res = await open(h, ids, anonymous, bad);
      expect([bad, res.status, await res.json()]).toEqual([bad, 400, { code: 'invalid_cursor' }]);
    }
    expect((await open(h, ids, anonymous, '1.1.5.2.2.100.0')).status).toBe(200);
    expect(h.gets).toEqual([]);
  });
});

describe('who may open the stream', () => {
  it('a kept check: 404 with no event and no evidence read for a visitor and for another account', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'kept.example');
    await storeBatch(h, ids, 1, one, { pages: 2, links: 2 });
    await keep(db, ids, owner);
    for (const viewer of [anonymous, { userId: stranger }]) {
      const res = await open(h, ids, viewer);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({ code: 'not_found' });
    }
    expect(h.gets).toEqual([]);
    expect(h.snapshots()).toBe(0);

    h.betweenPolls.push(cancelled(h, ids));
    const mine = await open(h, ids, { userId: owner });
    expect(mine.status).toBe(200);
    expect(groupsOf(await mine.text()).groups[0]!.events[0]!.type).toBe('page_fetched');
  });

  it('404 for an expired check, an unknown id and an id that is not a uuid', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'expired.example');
    await db.query(`update public.checks set expires_at = $2 where id = $1`, [
      ids.checkId,
      new Date(NOW).toISOString(),
    ]);
    for (const id of [ids.checkId, '00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
      const res = await open(h, { ...ids, checkId: id });
      expect([id, res.status]).toEqual([id, 404]);
    }
    expect(h.snapshots()).toBe(0);
  });

  it('closes, sending nothing more, when the check is kept by an account mid-stream', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'claimed-mid.example');
    await storeBatch(h, ids, 1, one, { pages: 2, links: 2 });
    h.betweenPolls.push(async () => {
      await keep(db, ids, owner);
      await storeBatch(h, ids, 2, two, { pages: 3, links: 3 });
    });
    const { groups } = groupsOf(await (await open(h, ids, { userId: stranger })).text());
    expect(
      groups.flatMap((g) => g.events).filter((e) => 'url' in e && e.url === urlOf('/b')),
    ).toEqual([]);
    expect(groups).toHaveLength(2);
    expect(h.gets.filter((p) => p.endsWith('batch-2.json.gz'))).toEqual([]);
    expect(h.snapshots()).toBe(2);
  });

  it('keeps going for the member whose account kept it mid-stream', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'mine-mid.example');
    h.betweenPolls.push(
      async () => {
        await keep(db, ids, owner);
        await storeBatch(h, ids, 1, one, { pages: 2, links: 2 });
      },
      cancelled(h, ids),
    );
    const { groups } = groupsOf(await (await open(h, ids, { userId: owner })).text());
    expect(groups.at(-1)!.events.at(-1)!.type).toBe('ended');
    expect(fold(groups.flatMap((g) => g.events)).nodes).toHaveLength(2);
  });

  it('closes when the check expires or its site is removed mid-stream', async () => {
    // Both instants are the harness clock's: the stream reads `expires_at` against `deps.now()`.
    const at = new Date(NOW).toISOString();
    for (const [host, change] of [
      ['expires-mid.example', `update public.checks set expires_at = $2 where site_id = $1`],
      ['removed-mid.example', `update public.sites set removed_at = $2 where id = $1`],
    ] as const) {
      const h = harness(db);
      const ids = await running(db, h, host);
      h.betweenPolls.push(async () => {
        await db.query(change, [ids.siteId, at]);
        await storeBatch(h, ids, 1, one, { pages: 2, links: 2 });
      });
      const { groups } = groupsOf(await (await open(h, ids)).text());
      expect([host, h.gets]).toEqual([host, []]);
      expect(groups).toHaveLength(1);
      expect(h.snapshots()).toBe(2);
    }
  });

  it('429 once an address has opened its hour’s streams, before anything is read', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'limited.example');
    h.denied.add('stream:ip:');
    const res = await open(h, ids);
    expect([res.status, await res.json()]).toEqual([429, { code: 'rate_limited' }]);
    expect(h.limits).toEqual([`stream:ip:203.0.113.7`]);
    expect(h.snapshots()).toBe(0);
    expect(STREAM_OPENS_PER_IP_PER_HOUR).toBe(120);
  });
});

describe('a check that finished', () => {
  it('closes each step, ends finished, and reports the scores its row holds', async () => {
    const h = harness(db);
    const recorded = recordedBuild();
    const built = buildCheck(recorded);
    const crawl = (recorded.batches as BatchResult[]).flatMap((b): CrawlPage[] =>
      b.kind === 'crawl' ? b.pages : [],
    );
    await seedRunningCheck(db, recorded.site, recorded.check);
    await persistBuiltCheck(pglitePersistDb(db), {
      built,
      vantage: pageVantage(crawl),
      map_path: null,
    });
    h.clock.now = Date.parse(recorded.check.finished_at) + 60_000;
    const ids = { siteId: recorded.site.id, checkId: recorded.check.id };

    const { groups } = groupsOf(await (await open(h, ids)).text());
    const state = fold(groups.flatMap((g) => g.events));
    expect(state.steps.every((s) => s.state === 'done')).toBe(true);
    expect(state.ended).toBe(built.check.status);
    const { rows } = await db.query<{
      seo: number | null;
      withheld: boolean;
      total: number | null;
    }>(
      `select (technical_seo ->> 'score')::float as seo,
              (ai_readability ->> 'withheld')::boolean as withheld,
              (ai_readability ->> 'total')::float as total
         from public.checks where id = $1`,
      [ids.checkId],
    );
    expect(h.captured[0]!.properties).toMatchObject({
      status: built.check.status,
      durationMs: Date.parse(recorded.check.finished_at) - Date.parse(recorded.check.started_at),
      seo: rows[0]!.seo,
      withheld: rows[0]!.withheld,
      aiReadability: rows[0]!.withheld ? null : rows[0]!.total,
    });
  }, 60_000);
});
