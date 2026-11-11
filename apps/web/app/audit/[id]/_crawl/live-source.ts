/**
 * The state of a real check's crawl screen, built from its progress stream
 * (`GET /api/checks/[id]/stream`).
 *
 * The stream sends events in groups, and the last event of a group carries an id (the server's
 * cursor). Events are held until their group's id arrives and are applied together then, so a
 * connection cut inside a group leaves no part of it applied: the browser reconnects with the last
 * id it saw and the server sends the group again, whole.
 *
 * A message that is not a `ProgressEvent`, and an event `reduce` refuses (out of order, or after
 * the end), is dropped: the state stays the last good one.
 *
 * Between events the elapsed time is advanced by `tick`, from the last event's time and the clock.
 */
import {
  INITIAL_STATE,
  ProgressEventSchema,
  reduce,
  type CrawlState,
  type ProgressEvent,
} from '../../../../lib/v2/progress';

export interface LiveSource {
  subscribe(listener: () => void): () => void;
  getState(): CrawlState;
  /** One message of the stream: its data, and the last event id the connection has seen. */
  receive(data: string, lastEventId: string): void;
  /** The connection was cut: the events of a group whose id has not arrived are forgotten. */
  interrupted(): void;
  /** A connection opened without a last event id: the server starts from the check's beginning. */
  reset(): void;
  /** Advances the elapsed time to the clock's, while the check has not ended. */
  tick(): void;
  /** Messages and events dropped so far. */
  dropped(): number;
}

export function createLiveSource(clock: { now(): number }): LiveSource {
  const listeners = new Set<() => void>();
  let state = INITIAL_STATE;
  let held: ProgressEvent[] = [];
  let lastId = '';
  let dropped = 0;
  /** The clock's reading when the last group was applied. */
  let appliedAt = clock.now();

  const notify = () => listeners.forEach((l) => l());

  function apply(events: readonly ProgressEvent[]) {
    let next = state;
    for (const event of events) {
      try {
        next = reduce(next, event);
      } catch {
        dropped++;
      }
    }
    if (next === state) return;
    // While the check runs the clock shown does not step back to an event's own time.
    state =
      next.ended === null && state.elapsed_ms > next.elapsed_ms
        ? { ...next, elapsed_ms: state.elapsed_ms }
        : next;
    appliedAt = clock.now();
    notify();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    receive(data, lastEventId) {
      let parsed: ReturnType<typeof ProgressEventSchema.safeParse>;
      try {
        parsed = ProgressEventSchema.safeParse(JSON.parse(data));
      } catch {
        parsed = ProgressEventSchema.safeParse(undefined);
      }
      if (parsed.success) held.push(parsed.data);
      else dropped++;
      if (lastEventId === '' || lastEventId === lastId) return;
      lastId = lastEventId;
      const group = held;
      held = [];
      apply(group);
    },
    interrupted() {
      held = [];
    },
    reset() {
      held = [];
      lastId = '';
      if (state === INITIAL_STATE) return;
      state = INITIAL_STATE;
      appliedAt = clock.now();
      notify();
    },
    tick() {
      if (state.ended !== null || state.last_ms === 0) return;
      const elapsed = state.last_ms + Math.round(clock.now() - appliedAt);
      if (elapsed <= state.elapsed_ms) return;
      state = { ...state, elapsed_ms: elapsed };
      notify();
    },
    dropped: () => dropped,
  };
}
