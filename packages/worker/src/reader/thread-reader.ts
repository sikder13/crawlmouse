import { Worker, type ResourceLimits } from 'node:worker_threads';
import type { NotRead, PageRead, PageReader, ReaderFailure, WordCount } from './read.js';

/**
 * The page reader on one thread, created once per process. Reads are answered in the order sent, so
 * the oldest unanswered read is the one the thread is on. Each body is handed over as UTF-8 bytes in a
 * transferred ArrayBuffer, never copied.
 *
 * The read the thread is on has READ_DEADLINE_MS from when the thread reached it. Past that, the
 * thread is stopped and that read answers `reader_deadline`; if the thread dies (out of memory, say),
 * that read answers `reader_thread_crashed`. Either way only that read fails: the reads queued behind
 * it are sent again, in order, to a new thread. A read that throws inside the reader rejects with the
 * error's message and the thread goes on. The thread holds the process open only while a read is
 * pending.
 */

/** The reader thread's old space. src/load.test.ts reads pages at the read limits under it. */
export const READER_HEAP_MB = 192;

/**
 * How long one read may take, from when the thread is ready and on it. The slowest page shape found
 * (review round 6: 2 MiB of stray close tags under 510 open elements; src/rows/text.test.ts) read in
 * 0.2 to 0.3 s on a workstation on 2026-10-31, and in about 1.0 s on the same machine while a load
 * test ran. A shared-cpu-1x VM whose CPU burst is spent runs at 6.25% of a core, so a 1.0 s read can
 * take about 16 s there (docs/ops/worker-runbook.md, CPU throttling).
 */
export const READ_DEADLINE_MS = 20_000;

export type ReadMessage =
  | { id: number; kind: 'words'; body: ArrayBuffer; bodyCut: boolean }
  | { id: number; kind: 'page'; body: ArrayBuffer; bodyCut: boolean; finalUrl: string };

export type ReadReply =
  | { id: number; result: WordCount | PageRead }
  | { id: number; error: string };
export type ReadyMessage = { ready: true };

type Ask =
  | { kind: 'words'; bodyCut: boolean }
  | { kind: 'page'; bodyCut: boolean; finalUrl: string };

interface Read {
  id: number;
  ask: Ask;
  /** Kept to send again to a new thread; the caller holds the same string until the read answers. */
  body: string;
  resolve: (r: WordCount | PageRead | NotRead) => void;
  reject: (e: Error) => void;
}

export class ThreadReader implements PageReader {
  private thread: Worker | null = null;
  /** Unanswered reads, oldest first: all sent to the current thread. */
  private readonly queue: Read[] = [];
  private deadline: NodeJS.Timeout | null = null;
  /** The current thread has loaded its entry; a read's deadline does not count the thread's boot. */
  private ready = false;
  private nextId = 0;
  /** Threads started after the first, each because the one before it died or was stopped. */
  restarts = 0;
  private started = 0;

  constructor(
    private readonly entry: URL,
    private readonly limits: ResourceLimits = { maxOldGenerationSizeMb: READER_HEAP_MB },
    private readonly deadlineMs: number = READ_DEADLINE_MS,
  ) {}

  /** Starts the thread now rather than at the first read; rejects if it cannot load its entry. */
  start(): Promise<void> {
    const thread = this.ensure();
    return new Promise<void>((resolve, reject) => {
      const ready = (m: ReadReply | ReadyMessage) => {
        if (!('ready' in m)) return;
        thread.off('message', ready);
        resolve();
      };
      thread.on('message', ready);
      thread.ref(); // until it is ready, or has failed
      thread.once('error', reject);
      thread.once('exit', (code) => reject(new Error(`the reader thread exited with ${code}`)));
    }).finally(() => {
      if (this.queue.length === 0) thread.unref();
    });
  }

  words(body: string, bodyCut: boolean): Promise<WordCount | NotRead> {
    return this.send({ kind: 'words', bodyCut }, body) as Promise<WordCount | NotRead>;
  }

  page(body: string, bodyCut: boolean, finalUrl: string): Promise<PageRead | NotRead> {
    return this.send({ kind: 'page', bodyCut, finalUrl }, body) as Promise<PageRead | NotRead>;
  }

  async close(): Promise<void> {
    this.disarm();
    const t = this.thread;
    this.thread = null;
    if (t) await t.terminate();
  }

  private send(ask: Ask, body: string): Promise<WordCount | PageRead | NotRead> {
    return new Promise((resolve, reject) => {
      const read: Read = { id: this.nextId++, ask, body, resolve, reject };
      this.queue.push(read);
      this.post(this.ensure(), read);
      if (this.queue.length === 1) this.arm();
    });
  }

  private post(thread: Worker, read: Read): void {
    // A fresh ArrayBuffer of its own: Buffer.from may hand back a slice of a shared pool, which a
    // transfer would detach from under other buffers.
    const bytes = new TextEncoder().encode(read.body).buffer as ArrayBuffer;
    thread.ref();
    thread.postMessage({ ...read.ask, id: read.id, body: bytes } satisfies ReadMessage, [bytes]);
  }

  /** Starts the deadline of the read the thread is now on, if any, once the thread is ready. */
  private arm(): void {
    this.disarm();
    if (this.queue.length === 0 || !this.ready) return;
    this.deadline = setTimeout(() => this.fail('reader_deadline'), this.deadlineMs);
  }

  private disarm(): void {
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = null;
  }

  /** The read the thread is on fails; the thread is dropped, and the rest go to a new one. */
  private fail(reason: ReaderFailure): void {
    this.disarm();
    const thread = this.thread;
    this.thread = null;
    // Stopped, for a deadline; already gone, for a crash. Its exit is ignored either way.
    if (reason === 'reader_deadline') void thread?.terminate();
    this.queue.shift()?.resolve({ failed: reason });
    if (this.queue.length === 0) return;
    const next = this.ensure();
    for (const read of this.queue) this.post(next, read);
    this.arm();
  }

  private ensure(): Worker {
    if (this.thread) return this.thread;
    if (this.started++ > 0) this.restarts++;
    const thread = new Worker(this.entry, { resourceLimits: this.limits });
    this.ready = false;
    thread.unref();
    const died = () => {
      if (this.thread === thread) this.fail('reader_thread_crashed');
    };
    thread.on('message', (reply: ReadReply | ReadyMessage) => {
      if (this.thread !== thread) return;
      if ('ready' in reply) {
        this.ready = true;
        return this.arm();
      }
      const read = this.queue[0];
      if (read?.id !== reply.id) return;
      this.queue.shift();
      if (this.queue.length === 0) thread.unref();
      this.arm();
      if ('error' in reply) read.reject(new Error(reply.error));
      else read.resolve(reply.result);
    });
    thread.on('error', died);
    thread.on('exit', died);
    this.thread = thread;
    return thread;
  }
}
