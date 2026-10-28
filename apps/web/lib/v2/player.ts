/**
 * Replays a recorded progress stream at its own timing. The clock is injected, so a test (or the
 * harness, through Playwright's fake clock) moves time and the player follows.
 *
 * Between events the elapsed time advances once a second, which is all the screen shows of it.
 * At the end of the recording the player stops and schedules nothing more: the screen goes still.
 */
import { INITIAL_STATE, reduce, stateAt, type CrawlState, type ProgressEvent } from './progress';

export interface Clock {
  now(): number;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => performance.now(),
  setTimeout: (cb, ms) => window.setTimeout(cb, ms),
  clearTimeout: (h) => window.clearTimeout(h as number),
};

export interface Playable {
  events: readonly ProgressEvent[];
  /** The last moment the recording covers: its end, or for a stream still open, its "now". */
  until_ms: number;
}

export interface Player {
  getState(): CrawlState;
  subscribe(listener: () => void): () => void;
  play(): void;
  pause(): void;
  playing(): boolean;
  seek(t: number): void;
  dispose(): void;
}

const SECOND = 1000;

export function createPlayer(
  recording: Playable,
  { clock, startAt = 0 }: { clock: Clock; startAt?: number },
): Player {
  const { events, until_ms } = recording;
  const listeners = new Set<() => void>();
  let position = Math.min(startAt, until_ms);
  let state = stateAt(events, position);
  let next = events.findIndex((e) => e.at_ms > position);
  let timer: unknown = null;
  let anchor: { clock: number; position: number } | null = null;

  const notify = () => listeners.forEach((l) => l());

  function advanceTo(t: number) {
    position = Math.min(t, until_ms);
    while (next !== -1 && next < events.length && events[next]!.at_ms <= position) {
      state = reduce(state, events[next]!);
      next++;
    }
    if (next >= events.length) next = -1;
    state = state.ended !== null ? state : { ...state, elapsed_ms: position };
  }

  function schedule() {
    if (!anchor) return;
    if (position >= until_ms || state.ended !== null) {
      // The end: nothing more is scheduled, and listeners hear that the replay is still.
      anchor = null;
      notify();
      return;
    }
    const nextEvent = next === -1 ? Infinity : events[next]!.at_ms;
    const nextSecond = (Math.floor(position / SECOND) + 1) * SECOND;
    const target = Math.min(nextEvent, nextSecond, until_ms);
    const at = anchor;
    timer = clock.setTimeout(() => {
      timer = null;
      advanceTo(at.position + (clock.now() - at.clock));
      notify();
      schedule();
    }, target - position);
  }

  function stop() {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    anchor = null;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play() {
      if (anchor) return;
      anchor = { clock: clock.now(), position };
      schedule();
      notify();
    },
    pause() {
      stop();
      notify();
    },
    playing: () => anchor !== null,
    seek(t) {
      const wasPlaying = anchor !== null;
      stop();
      if (t < position) {
        state = INITIAL_STATE;
        next = events.length ? 0 : -1;
      }
      advanceTo(t);
      notify();
      if (wasPlaying) {
        anchor = { clock: clock.now(), position };
        schedule();
      }
    },
    // Stops the timers only: React may subscribe again to the same player (strict mode remounts).
    dispose: stop,
  };
}
