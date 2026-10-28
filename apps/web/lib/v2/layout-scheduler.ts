/**
 * Hands layout requests to the Worker, one at a time, keeping only the newest while it is busy, and
 * delivers results no closer together than one settle, so a node finishes moving before it is
 * asked to move again. Where Worker is missing it runs the layout in idle time instead.
 *
 * The last request is always laid out and delivered, so the map ends on the layout of the final
 * graph however the requests were batched.
 */
import { layoutMap, type LayoutNode, type Point } from './map-layout';
import type { LayoutRequest } from './map-layout.worker';

export interface LayoutResult {
  version: number;
  positions: Record<string, Point>;
}

export interface LayoutScheduler {
  request(version: number, nodes: LayoutNode[]): void;
  dispose(): void;
}

export function createLayoutScheduler(
  onResult: (r: LayoutResult) => void,
  { minGapMs }: { minGapMs: number },
): LayoutScheduler {
  let pending: LayoutRequest | null = null;
  let busy = false;
  let lastDelivered = -Infinity;
  let disposed = false;
  let worker: Worker | null = null;
  try {
    worker =
      typeof Worker === 'function'
        ? new Worker(new URL('./map-layout.worker.ts', import.meta.url))
        : null;
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
      pump();
    }, wait);
  }

  if (worker) worker.onmessage = (e: MessageEvent<LayoutResult>) => deliver(e.data);

  const idle =
    typeof requestIdleCallback === 'function'
      ? (cb: () => void) => requestIdleCallback(cb, { timeout: 200 })
      : (cb: () => void) => setTimeout(cb, 1);

  function pump() {
    if (busy || !pending || disposed) return;
    const job = pending;
    pending = null;
    busy = true;
    if (worker) worker.postMessage(job);
    else idle(() => deliver({ version: job.version, positions: layoutMap(job.nodes) }));
  }

  return {
    request(version, nodes) {
      pending = { version, nodes };
      pump();
    },
    dispose() {
      disposed = true;
      worker?.terminate();
    },
  };
}
