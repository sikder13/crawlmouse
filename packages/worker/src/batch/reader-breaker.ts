import type { ReaderFailure } from '../reader/read.js';

/**
 * Keeps one host from holding the page reader, which every check on the worker shares. Per batch.
 *
 * A crash or a slow read does not by itself mean a hostile page: an ordinary page of about 2 MiB does
 * both. So it opens at once only for a page under SMALL_PAGE_CHARS, where neither has an innocent
 * cause (the largest of the 643 corpus pages is 147 KiB and the slowest read 34 ms), and otherwise
 * once the host has used HOST_READER_MS of the reader's time in this batch.
 */
export const SMALL_PAGE_CHARS = 256 * 1024;
export const SLOW_READ_MS = 5_000;
export const HOST_READER_MS = 180_000;

export class ReaderBreaker {
  private readonly hosts = new Map<string, { spentMs: number; open: boolean }>();

  isOpen(url: string): boolean {
    return this.hosts.get(new URL(url).hostname)?.open ?? false;
  }

  /** What one read of `chars` characters cost the reader, and whether it failed. */
  record(url: string, chars: number, read: { failed?: ReaderFailure; readMs?: number }): void {
    const host = new URL(url).hostname;
    const state = this.hosts.get(host) ?? { spentMs: 0, open: false };
    const ms = read.readMs ?? 0;
    state.spentMs += ms;
    const hostile = chars < SMALL_PAGE_CHARS && (read.failed !== undefined || ms > SLOW_READ_MS);
    if (hostile || state.spentMs > HOST_READER_MS) state.open = true;
    this.hosts.set(host, state);
  }
}
