import { describe, expect, it } from 'vitest';
import type { BatchResult } from './run.js';
import { BatchStore, MAX_RECORDS, MAX_RESULT_BYTES, RESULT_TTL_MS } from './store.js';

const progress = { urls_done: 0, urls_total: 1, requests: 0 };
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
