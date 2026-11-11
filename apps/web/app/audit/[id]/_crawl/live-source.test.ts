import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { frame } from '../../../api/checks/[id]/stream/serve';
import {
  START,
  batchEvents,
  checkEvents,
  type CheckFacts,
  type Cursor,
  type StoredBatch,
} from '../../../../lib/v2/pipeline/stream';
import {
  STARTED,
  crawlResult,
  edge,
  row,
  urlOf,
} from '../../../../lib/v2/pipeline/stream.fixtures';
import { INITIAL_STATE, PHASES, reduce, type ProgressEvent } from '../../../../lib/v2/progress';
import { createLiveSource } from './live-source';

const clockAt = (now = 0) => {
  const c = { now };
  return { c, clock: { now: () => c.now } };
};

/** Feeds SSE text to a source as a browser's EventSource does: the last event id is sticky. */
function deliver(source: ReturnType<typeof createLiveSource>, text: string, lastId = ''): string {
  let id = lastId;
  for (const block of text.split('\n\n')) {
    const lines = block.split('\n');
    const data = lines.find((l) => l.startsWith('data: '));
    const own = lines.find((l) => l.startsWith('id: '));
    if (own) id = own.slice(4);
    if (data) source.receive(data.slice(6), id);
  }
  return id;
}

const running = (now: number, pages: number, elapsedMs: number): CheckFacts => ({
  status: 'running',
  steps: PHASES.map((phase, i) => ({
    phase,
    state: i < now ? 'done' : i === now ? 'now' : 'next',
  })),
  counts: { pages_crawled: pages, links_found: pages * 2 },
  elapsedMs,
});

/** A run in three polls, as the groups the route frames: [events, cursor after]. */
function groups(): { events: ProgressEvent[]; cursor: Cursor }[] {
  const out: { events: ProgressEvent[]; cursor: Cursor }[] = [];
  let cursor = START;
  const keep = (got: { events: ProgressEvent[]; cursor: Cursor }) => {
    cursor = got.cursor;
    if (got.events.length) out.push(got);
  };
  const poll = (check: CheckFacts, batches: StoredBatch[]) => {
    for (const batch of batches) keep(batchEvents(cursor, batch, STARTED));
    keep(checkEvents(cursor, check));
  };
  poll(running(1, 0, 1000), []);
  poll(running(2, 2, 9000), [
    {
      batch: 1,
      result: crawlResult(
        [row({ path: '/', at: 500 }), row({ path: '/a', at: 900 })],
        [edge('/', '/a')],
      ),
    },
  ]);
  poll(
    {
      status: 'finished',
      steps: null,
      counts: { pages_crawled: 3, links_found: 6 },
      elapsedMs: 60_000,
    },
    [{ batch: 2, result: crawlResult([row({ path: '/b', at: 30_000 })], [edge('/b', '/')]) }],
  );
  return out;
}

const expected = groups()
  .flatMap((g) => g.events)
  .reduce(reduce, INITIAL_STATE);

describe('the live source', () => {
  it('applies a group when its id arrives, and not before', () => {
    const source = createLiveSource(clockAt().clock);
    const [first] = groups();
    let heard = 0;
    source.subscribe(() => heard++);
    const text = frame(first!.events, first!.cursor);
    const blocks = text.split('\n\n').filter(Boolean);
    expect(blocks.length).toBeGreaterThan(1);
    deliver(source, `${blocks.slice(0, -1).join('\n\n')}\n\n`);
    expect(source.getState()).toBe(INITIAL_STATE);
    expect(heard).toBe(0);
    deliver(source, `${blocks.at(-1)}\n\n`);
    expect(source.getState().steps[0]).toEqual({ phase: 'robots_and_sitemap', state: 'done' });
    expect(heard).toBe(1);
  });

  it('a connection cut anywhere, then the server’s resend from the last id, gives the same state', () => {
    const all = groups();
    const texts = all.map((g) => frame(g.events, g.cursor));
    fc.assert(
      fc.property(
        fc.nat(all.length - 1),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (cutGroup, where) => {
          const source = createLiveSource(clockAt().clock);
          let id = '';
          for (let g = 0; g < texts.length; g++) {
            if (g === cutGroup) {
              // Part of the group arrives, in whole messages, and the connection drops.
              const blocks = texts[g]!.split('\n\n').filter(Boolean);
              const kept = blocks.slice(0, Math.floor(where * blocks.length));
              deliver(
                source,
                kept
                  .map((b) => `${b}\n\n`)
                  .join('')
                  .replace(/^id: .*\n/m, ''),
                id,
              );
              source.interrupted();
            }
            id = deliver(source, texts[g]!, id);
          }
          expect(source.getState()).toEqual(expected);
          expect(source.dropped()).toBe(0);
        },
      ),
    );
    expect(expected.nodes.map((n) => n.url)).toEqual([urlOf('/'), urlOf('/a'), urlOf('/b')]);
    expect(expected.ended).toBe('finished');
  });

  it('drops what is not an event and what reduce refuses, and keeps the last good state', () => {
    const source = createLiveSource(clockAt().clock);
    const all = groups();
    let id = deliver(source, frame(all[0]!.events, all[0]!.cursor));
    const good = source.getState();
    source.receive('not json', id);
    source.receive('{"type":"stage","at_ms":1,"phase":"nope","state":"now"}', 'x1');
    // A stage that already happened, with a new id: reduce refuses it.
    source.receive(JSON.stringify(all[0]!.events[0]), 'x2');
    expect(source.getState()).toBe(good);
    expect(source.dropped()).toBe(3);
    // The stream goes on after it.
    id = deliver(source, frame(all[1]!.events, all[1]!.cursor), 'x2');
    expect(source.getState().nodes).toHaveLength(2);
  });

  it('is unmoved by the end sent again to a viewer who has it', () => {
    const source = createLiveSource(clockAt().clock);
    let id = '';
    for (const g of groups()) id = deliver(source, frame(g.events, g.cursor), id);
    const ended = source.getState();
    const last = groups().at(-1)!;
    deliver(source, frame([last.events.at(-1)!], last.cursor), id);
    source.receive(JSON.stringify(last.events.at(-1)), 'another-id');
    expect(source.getState()).toBe(ended);
  });

  it('reset goes back to the beginning, for a connection opened without a last event id', () => {
    const source = createLiveSource(clockAt().clock);
    const all = groups();
    deliver(source, frame(all[0]!.events, all[0]!.cursor));
    source.reset();
    expect(source.getState()).toBe(INITIAL_STATE);
    let id = '';
    for (const g of all) id = deliver(source, frame(g.events, g.cursor), id);
    expect(source.getState()).toEqual(expected);
  });

  it('ticks the elapsed time from the last event while the check runs, and not after it ends', () => {
    const { c, clock } = clockAt(50_000);
    const source = createLiveSource(clock);
    const all = groups();
    source.tick();
    expect(source.getState()).toBe(INITIAL_STATE);
    let id = deliver(source, frame(all[0]!.events, all[0]!.cursor));
    expect(source.getState().elapsed_ms).toBe(1000);
    c.now += 4000;
    source.tick();
    expect(source.getState().elapsed_ms).toBe(5000);
    expect(source.getState().last_ms).toBe(1000);
    // An event stamped earlier than the clock shown does not take the clock back.
    id = deliver(
      source,
      frame([{ type: 'counts', at_ms: 2000, pages_crawled: 1, links_found: 0 }], {
        ...all[0]!.cursor,
        pages: 1,
      }),
      id,
    );
    expect(source.getState().elapsed_ms).toBe(5000);
    for (const g of all.slice(1)) id = deliver(source, frame(g.events, g.cursor), id);
    c.now += 9000;
    source.tick();
    expect(source.getState().elapsed_ms).toBe(60_000);
  });
});
