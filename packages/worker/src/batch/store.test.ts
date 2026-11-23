import { describe, expect, it } from 'vitest';
import type { BatchResult } from './run.js';
import {
  BatchStore,
  LIVE_PAGES_PER_READ,
  MAX_RECORDS,
  MAX_RESULT_BYTES,
  RESULT_TTL_MS,
} from './store.js';

const progress = {
  urls_done: 0,
  urls_total: 1,
  requests: 0,
  pages: 0,
  links: 0,
  homepage_read: false,
};
/** A result whose JSON is about `bytes` long, with non-Latin-1 text, so a UTF-16 string would double it. */
const result = (bytes: number) =>
  ({ kind: 'access', note: '’'.repeat(Math.floor(bytes / 3)) }) as unknown as BatchResult;

describe('BatchStore', () => {
  it('keeps finished results under MAX_RESULT_BYTES of UTF-8, forgetting the oldest first', () => {
    let t = 0;
    const store = new BatchStore(() => t);
    // Six results of a fifth each, plus their JSON overhead: the two oldest must go.
    const each = MAX_RESULT_BYTES / 5;
    for (let i = 0; i < 6; i++) {
      t += 1;
      store.start(`c:${i}`, progress);
      store.finish(`c:${i}`, result(each));
    }
    expect(store.get('c:0')).toBeUndefined();
    expect(store.get('c:1')).toBeUndefined();
    expect(store.get('c:2')?.status).toBe('done');
    expect(store.get('c:5')?.status).toBe('done');
  });

  it('holds a result as UTF-8 bytes, off the JavaScript heap', () => {
    const store = new BatchStore(() => 0);
    store.start('c:1', progress);
    store.finish('c:1', result(3000));
    const r = store.get('c:1');
    expect(r?.status === 'done' && Buffer.isBuffer(r.json)).toBe(true);
  });

  it('never forgets a running batch, and forgets a finished one at its TTL', () => {
    let t = 0;
    const store = new BatchStore(() => t);
    store.start('run', progress);
    for (let i = 0; i < MAX_RECORDS + 5; i++) {
      store.start(`c:${i}`, progress);
      store.finish(`c:${i}`, result(10));
    }
    expect(store.get('run')?.status).toBe('running');
    // The count includes the running batch, which is never the one forgotten.
    expect(store.size).toBe(MAX_RECORDS);
    t += RESULT_TTL_MS;
    expect(store.get('c:0')).toBeUndefined();
    expect(store.get('run')?.status).toBe('running');
  });
});

describe('the pages a running batch has finished', () => {
  const live = (n: number) => ({
    url: `https://site.test/${n}`,
    status: 200,
    ms: 5,
    links: 0,
    identity: 'browser',
    edges: [],
  });
  const counts = {
    urls_done: 1,
    urls_total: 3,
    requests: 1,
    pages: 1,
    links: 0,
    homepage_read: false,
  };

  it('hands them out from an offset, at most LIVE_PAGES_PER_READ at a time', () => {
    const store = new BatchStore(() => 0);
    store.start('b', { ...counts, urls_done: 0, pages: 0 });
    for (let i = 0; i < LIVE_PAGES_PER_READ + 5; i++) store.progress('b', counts, live(i));
    const first = store.livePages('b', 0);
    expect(first.total).toBe(LIVE_PAGES_PER_READ + 5);
    expect(first.pages).toHaveLength(LIVE_PAGES_PER_READ);
    expect(store.livePages('b', LIVE_PAGES_PER_READ).pages.map((p) => p.url)).toEqual(
      [0, 1, 2, 3, 4].map((n) => `https://site.test/${LIVE_PAGES_PER_READ + n}`),
    );
  });

  it('gives nothing for a batch that is not running', () => {
    const store = new BatchStore(() => 0);
    expect(store.livePages('none', 0)).toEqual({ total: 0, pages: [] });
    store.start('b', counts);
    store.progress('b', counts, live(0));
    store.fail('b');
    expect(store.livePages('b', 0)).toEqual({ total: 0, pages: [] });
  });
});
