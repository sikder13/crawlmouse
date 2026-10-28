import type { BatchResult, Progress } from './run.js';

/**
 * Batch records, in memory. A record is kept until RESULT_TTL_MS after its batch finishes, then
 * forgotten (GET answers 404). Finished records are also forgotten oldest first when there are more
 * than MAX_RECORDS of them or their results exceed MAX_RESULT_BYTES in all. A running batch is never
 * forgotten: the concurrency limit bounds those.
 *
 * Nothing survives a restart or a deploy: a poll for a batch the process no longer holds answers 404,
 * and the caller sends the batch again.
 */

export const RESULT_TTL_MS = 60 * 60_000;
export const MAX_RECORDS = 500;
export const MAX_RESULT_BYTES = 64 * 1024 * 1024;

export type BatchRecord =
  | { status: 'running'; accepted_at: number; progress: Progress }
  | { status: 'done'; accepted_at: number; finished_at: number; json: string; bytes: number }
  | { status: 'failed'; accepted_at: number; finished_at: number; progress: Progress };

export class BatchStore {
  private readonly records = new Map<string, BatchRecord>();
  private resultBytes = 0;

  constructor(private readonly now: () => number) {}

  has(id: string): boolean {
    this.prune();
    return this.records.has(id);
  }

  get(id: string): BatchRecord | undefined {
    this.prune();
    return this.records.get(id);
  }

  start(id: string, progress: Progress): void {
    this.records.set(id, { status: 'running', accepted_at: this.now(), progress });
  }

  progress(id: string, progress: Progress): void {
    const r = this.records.get(id);
    if (r?.status === 'running') r.progress = progress;
  }

  finish(id: string, result: BatchResult): void {
    const r = this.records.get(id);
    if (r?.status !== 'running') return;
    const json = JSON.stringify(result);
    const bytes = Buffer.byteLength(json);
    this.records.set(id, {
      status: 'done',
      accepted_at: r.accepted_at,
      finished_at: this.now(),
      json,
      bytes,
    });
    this.resultBytes += bytes;
    this.prune();
  }

  fail(id: string): void {
    const r = this.records.get(id);
    if (r?.status !== 'running') return;
    this.records.set(id, {
      status: 'failed',
      accepted_at: r.accepted_at,
      finished_at: this.now(),
      progress: r.progress,
    });
    this.prune();
  }

  get size(): number {
    return this.records.size;
  }

  private forget(id: string, r: BatchRecord): void {
    if (r.status === 'done') this.resultBytes -= r.bytes;
    this.records.delete(id);
  }

  private prune(): void {
    const t = this.now();
    for (const [id, r] of this.records) {
      if (r.status !== 'running' && t - r.finished_at >= RESULT_TTL_MS) this.forget(id, r);
    }
    const finished = [...this.records].flatMap(([id, r]) =>
      r.status === 'running' ? [] : [{ id, r }],
    );
    finished.sort((a, b) => a.r.finished_at - b.r.finished_at);
    for (const { id, r } of finished) {
      if (this.records.size <= MAX_RECORDS && this.resultBytes <= MAX_RESULT_BYTES) break;
      this.forget(id, r);
    }
  }
}
