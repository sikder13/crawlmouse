import { Worker, type ResourceLimits } from 'node:worker_threads';
import type { Crashed, PageRead, PageReader, WordCount } from './read.js';

/**
 * The page reader on one thread, created once per process. Reads are answered in the order sent. Each
 * body is handed over as UTF-8 bytes in a transferred ArrayBuffer, never copied.
 *
 * If the thread dies (out of memory, say), every read it had not answered comes back `crashed`, and the
 * next read starts a new thread. The thread holds the process open only while a read is pending.
 */

/** The reader thread's old space. src/load.test.ts reads pages at the read limits under it. */
export const READER_HEAP_MB = 192;

export type ReadMessage =
  | { id: number; kind: 'words'; body: ArrayBuffer; bodyCut: boolean }
  | { id: number; kind: 'page'; body: ArrayBuffer; bodyCut: boolean; finalUrl: string };

export type ReadReply = { id: number; result: WordCount | PageRead };
export type ReadyMessage = { ready: true };

type Pending = (r: WordCount | PageRead | Crashed) => void;

export class ThreadReader implements PageReader {
  private thread: Worker | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  /** Threads started after the first, each because the one before it died. */
  restarts = 0;
  private started = 0;

  constructor(
    private readonly entry: URL,
    private readonly limits: ResourceLimits = { maxOldGenerationSizeMb: READER_HEAP_MB },
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
      if (this.pending.size === 0) thread.unref();
    });
  }

  words(body: string, bodyCut: boolean): Promise<WordCount | Crashed> {
    return this.send({ kind: 'words', bodyCut }, body) as Promise<WordCount | Crashed>;
  }

  page(body: string, bodyCut: boolean, finalUrl: string): Promise<PageRead | Crashed> {
    return this.send({ kind: 'page', bodyCut, finalUrl }, body) as Promise<PageRead | Crashed>;
  }

  async close(): Promise<void> {
    const t = this.thread;
    this.thread = null;
    if (t) await t.terminate();
  }

  private send(
    m: { kind: 'words'; bodyCut: boolean } | { kind: 'page'; bodyCut: boolean; finalUrl: string },
    body: string,
  ): Promise<WordCount | PageRead | Crashed> {
    const thread = this.ensure();
    const id = this.nextId++;
    // A fresh ArrayBuffer of its own: Buffer.from may hand back a slice of a shared pool, which a
    // transfer would detach from under other buffers.
    const bytes = new TextEncoder().encode(body).buffer as ArrayBuffer;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      thread.ref();
      thread.postMessage({ ...m, id, body: bytes } satisfies ReadMessage, [bytes]);
    });
  }

  private ensure(): Worker {
    if (this.thread) return this.thread;
    if (this.started++ > 0) this.restarts++;
    const thread = new Worker(this.entry, { resourceLimits: this.limits });
    thread.unref();
    const died = () => {
      if (this.thread !== thread) return;
      this.thread = null;
      const waiting = [...this.pending.values()];
      this.pending.clear();
      for (const resolve of waiting) resolve({ crashed: true });
    };
    thread.on('message', (reply: ReadReply | ReadyMessage) => {
      if ('ready' in reply) return;
      const resolve = this.pending.get(reply.id);
      this.pending.delete(reply.id);
      if (this.pending.size === 0) thread.unref();
      resolve?.(reply.result);
    });
    thread.on('error', died);
    thread.on('exit', died);
    this.thread = thread;
    return thread;
  }
}
