import { describe, expect, it } from 'vitest';
import { createPlayer, type Clock } from './player';
import type { ProgressEvent } from './progress';

/** A clock that moves only when the test says so, and runs due timers in order. */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; cb: () => void }>();
  const clock: Clock = {
    now: () => now,
    setTimeout(cb, ms) {
      const id = ++seq;
      timers.set(id, { at: now + Math.max(0, ms), cb });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id as number);
    },
  };
  function advance(ms: number) {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].cb();
    }
    now = target;
  }
  return { clock, advance, pending: () => timers.size };
}

const EVENTS: ProgressEvent[] = [
  { type: 'stage', at_ms: 0, phase: 'robots_and_sitemap', state: 'now' },
  { type: 'pages_estimated', at_ms: 1500, pages: 9 },
  { type: 'counts', at_ms: 2500, pages_crawled: 1, links_found: 3 },
  { type: 'ended', at_ms: 4000, status: 'failed' },
];

describe('the replay player', () => {
  it('applies each event at its moment on the clock, and an event exactly at the moment', () => {
    const { clock, advance } = fakeClock();
    const p = createPlayer({ events: EVENTS, until_ms: 4000 }, { clock });
    p.play();
    advance(1499);
    expect(p.getState().pages_estimated).toBeNull();
    advance(1);
    expect(p.getState().pages_estimated).toBe(9);
    advance(1000);
    expect(p.getState().pages_crawled).toBe(1);
  });

  it('ticks the elapsed time once a second between events, never between seconds', () => {
    const { clock, advance } = fakeClock();
    const p = createPlayer({ events: EVENTS, until_ms: 4000 }, { clock });
    const seen: number[] = [];
    p.subscribe(() => seen.push(p.getState().elapsed_ms));
    p.play();
    advance(3000);
    expect(seen).toEqual([1000, 1500, 2000, 2500, 3000]);
  });

  it('stops scheduling at the end of the recording: nothing moves after it', () => {
    const { clock, advance, pending } = fakeClock();
    const p = createPlayer({ events: EVENTS, until_ms: 4000 }, { clock });
    p.play();
    advance(10_000);
    expect(p.getState().ended).toBe('failed');
    expect(p.getState().elapsed_ms).toBe(4000);
    expect(p.playing()).toBe(false);
    expect(pending()).toBe(0);
  });

  it('stops an open recording at the moment it covers, with the clock there', () => {
    const { clock, advance, pending } = fakeClock();
    const p = createPlayer({ events: EVENTS.slice(0, 3), until_ms: 3600 }, { clock });
    p.play();
    advance(60_000);
    expect(p.getState().ended).toBeNull();
    expect(p.getState().elapsed_ms).toBe(3600);
    expect(pending()).toBe(0);
  });

  it('seeks forward and back to the same state a replay from the start reaches', () => {
    const { clock } = fakeClock();
    const p = createPlayer({ events: EVENTS, until_ms: 4000 }, { clock });
    p.seek(2600);
    const forward = p.getState();
    p.seek(100);
    expect(p.getState().pages_crawled).toBe(0);
    p.seek(2600);
    expect(p.getState()).toEqual(forward);
  });

  it('starts at a moment when asked, paused there', () => {
    const { clock, advance } = fakeClock();
    const p = createPlayer({ events: EVENTS, until_ms: 4000 }, { clock, startAt: 2500 });
    expect(p.getState().pages_crawled).toBe(1);
    advance(5000);
    expect(p.getState().elapsed_ms).toBe(2500);
  });

  it('cancels its timers when disposed', () => {
    const { clock, pending } = fakeClock();
    const p = createPlayer({ events: EVENTS, until_ms: 4000 }, { clock });
    p.play();
    expect(pending()).toBe(1);
    p.dispose();
    expect(pending()).toBe(0);
  });
});
