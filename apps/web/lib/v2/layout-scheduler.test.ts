import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayoutScheduler, type LayoutResult } from './layout-scheduler';
import type { LayoutNode } from './map-layout';

const graph = (n: number): LayoutNode[] => [
  { id: 'https://example.test/', parent: null, depth: 0, kind: 'page', via: null },
  ...Array.from({ length: n }, (_, i) => ({
    id: `https://example.test/p${i}`,
    parent: 'https://example.test/',
    depth: 1,
    kind: 'page' as const,
    via: 'link' as const,
  })),
];

describe('the layout scheduler', () => {
  beforeEach(() =>
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'queueMicrotask', 'performance', 'Date'],
    }),
  );
  afterEach(() => vi.useRealTimers());

  it('keeps only the newest request while busy, and delivers the last, a gap apart', () => {
    const got: { version: number; at: number; nodes: number }[] = [];
    const s = createLayoutScheduler(
      (r: LayoutResult) =>
        got.push({
          version: r.version,
          at: performance.now(),
          nodes: Object.keys(r.positions).length,
        }),
      { minGapMs: 1000, makeWorker: () => null },
    );
    s.request(1, graph(1));
    s.request(2, graph(2));
    s.request(3, graph(3));
    vi.advanceTimersByTime(5_000);
    expect(got.map((g) => g.version)).toEqual([1, 3]);
    expect(got.at(-1)!.nodes).toBe(4);
    expect(got[1]!.at - got[0]!.at).toBeGreaterThanOrEqual(1000);
    s.dispose();
  });

  it('lays the job out itself when the Worker fails, and every job after', () => {
    /** A Worker that fails each job it is given. */
    class FailingWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      onmessageerror: ((e: Event) => void) | null = null;
      terminated = false;
      postMessage() {
        queueMicrotask(() => this.onerror?.(new Event('error')));
      }
      terminate() {
        this.terminated = true;
      }
    }
    let worker: FailingWorker | null = null;
    const fake = () => {
      worker = new FailingWorker();
      return worker as unknown as Worker;
    };
    const got: number[] = [];
    const s = createLayoutScheduler((r) => got.push(r.version), { minGapMs: 0, makeWorker: fake });
    s.request(1, graph(2));
    return Promise.resolve().then(() => {
      vi.advanceTimersByTime(1_000);
      s.request(2, graph(3));
      vi.advanceTimersByTime(1_000);
      expect(worker!.terminated).toBe(true);
      expect(got).toEqual([1, 2]);
      s.dispose();
    });
  });
});
