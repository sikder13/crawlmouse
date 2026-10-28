/**
 * Hands layout requests to the Worker, one at a time, keeping only the newest while it is busy, and
 * delivers results no closer together than `minGapMs`, so a node finishes moving before it is
 * asked to move again. Where Worker is missing it runs the layout in idle time instead.
 *
 * The last request is laid out and delivered, so the map ends on the layout of the final graph
 * however the requests were batched (layout-scheduler.test.ts). If the Worker fails, the job it had
 * and every later one run on the main thread when it is idle, so the map is never left waiting; a
 * cold layout of a large site is then one long task, the price of a failed Worker.
 */
import { layoutMapFrom, type LayoutNode, type Point } from './map-layout';
import type { LayoutRequest } from './map-layout.worker';

export interface LayoutResult {
  version: number;
  positions: Record<string, Point>;
  /** The simulation's own positions, to seed a warm layout from. */
  raw: Record<string, Point>;
}

export interface LayoutScheduler {
  /** Lay `nodes` out: warm from `seed`, or cold when it is null. */
  request(version: number, nodes: LayoutNode[], seed?: Record<string, Point> | null): void;
  dispose(): void;
}

function layoutWorker(): Worker | null {
  return typeof Worker === 'function'
    ? new Worker(new URL('./map-layout.worker.ts', import.meta.url))
    : null;
}

export function createLayoutScheduler(
  onResult: (r: LayoutResult) => void,
  { minGapMs, makeWorker = layoutWorker }: { minGapMs: number; makeWorker?: () => Worker | null },
): LayoutScheduler {
  let pending: LayoutRequest | null = null;
  let inFlight: LayoutRequest | null = null;
  let busy = false;
  let lastDelivered = -Infinity;
  let disposed = false;
  let worker: Worker | null = null;
  try {
    worker = makeWorker();
  } catch {
    worker = null;
  }

  function deliver(r: LayoutResult) {
    const wait = Math.max(0, lastDelivered + minGapMs - performance.now());
    setTimeout(() => {
      if (disposed) return;
      lastDelivered = performance.now();
      onResult(r);
      busy = false;
      inFlight = null;
      pump();
    }, wait);
  }

  if (worker) {
    worker.onmessage = (e: MessageEvent<LayoutResult>) => deliver(e.data);
    // A Worker that fails is dropped: its job, and the rest, are laid out here instead.
    worker.onerror = worker.onmessageerror = (e: Event) => {
      e.preventDefault();
      worker?.terminate();
      worker = null;
      const job = inFlight;
      if (job && !disposed)
        idle(() => deliver({ version: job.version, ...layoutMapFrom(job.nodes, job.seed) }));
    };
  }

  const idle =
    typeof requestIdleCallback === 'function'
      ? (cb: () => void) => requestIdleCallback(cb, { timeout: 200 })
      : (cb: () => void) => setTimeout(cb, 1);

  function pump() {
    if (busy || !pending || disposed) return;
    const job = pending;
    pending = null;
    inFlight = job;
    busy = true;
    if (worker) worker.postMessage(job);
    else idle(() => deliver({ version: job.version, ...layoutMapFrom(job.nodes, job.seed) }));
  }

  return {
    request(version, nodes, seed = null) {
      pending = { version, nodes, seed };
      pump();
    },
    dispose() {
      disposed = true;
      worker?.terminate();
    },
  };
}
