import type { Clock } from '../clock.js';

/**
 * A clock for many sleepers at once. A sleep waits until `run` moves time to its due moment. `run`
 * moves time after letting other work run for 8 turns of the event loop, which is enough when every
 * wait in the work is a sleep on this clock (a fake fetcher, the inline reader). Work that waits on
 * real I/O or a real timer can still be pending when time moves, so this clock is for such tests
 * only.
 *
 * InstantClock (clock.ts here) cannot do this: its sleeps return at once and add to one shared time,
 * so two concurrent sleepers would each push time forward by their own wait.
 */
export class VirtualClock implements Clock {
  private timers: Array<{ due: number; seq: number; wake: () => void }> = [];
  private seq = 0;

  constructor(private t = 1_700_000_000_000) {}

  now(): number {
    return this.t;
  }

  sleep(ms: number): Promise<void> {
    return new Promise((wake) => {
      this.timers.push({ due: this.t + Math.max(0, ms), seq: this.seq++, wake });
    });
  }

  /** Settles `work`, moving time to the next due sleep whenever nothing else can run. */
  async run<T>(work: Promise<T>): Promise<T> {
    let settled = false;
    const done = work.finally(() => (settled = true));
    done.catch(() => undefined);
    for (let turns = 0; ; turns++) {
      // Let every task that can run do so before time moves (promise jobs, then I/O callbacks).
      for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
      if (settled) return done;
      if (this.timers.length === 0)
        throw new Error('VirtualClock: nothing is due and the work has not settled');
      if (turns > 1_000_000) throw new Error('VirtualClock: too many turns');
      this.timers.sort((a, b) => a.due - b.due || a.seq - b.seq);
      const due = this.timers[0]!.due;
      this.t = Math.max(this.t, due);
      const wake = this.timers.filter((x) => x.due <= this.t);
      this.timers = this.timers.filter((x) => x.due > this.t);
      for (const x of wake) x.wake();
    }
  }
}
