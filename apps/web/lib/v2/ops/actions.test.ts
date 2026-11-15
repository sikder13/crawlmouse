import { describe, expect, it } from 'vitest';
import { DONE_CODES, DONE_LINES, doneOf, doneTo, readReason, REASON_MAX } from './actions';

const ACCOUNT = '6f1c2a8e-0000-4000-8000-00000000000a';

describe('readReason', () => {
  it('trims, and takes 1 to 500 characters', () => {
    expect(readReason({ reason: '  stuck check  ' })).toBe('stuck check');
    expect(readReason({ reason: 'x'.repeat(REASON_MAX) })).toBe('x'.repeat(REASON_MAX));
  });

  it('refuses none, an empty one, a long one, a non-string, and one holding an address', () => {
    for (const fields of [
      {},
      { reason: '   ' },
      { reason: 'x'.repeat(REASON_MAX + 1) },
      { reason: 5 },
      { reason: ['a'] },
      { reason: `asked by ${['pat', 'example.com'].join('@')}` },
    ])
      expect(readReason(fields), JSON.stringify(fields)).toBeNull();
  });
});

describe('the notice an action sends the account page back with', () => {
  it('is a 303 to the account page with the code alone', () => {
    const res = doneTo(ACCOUNT, 'link_sent');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/internal/accounts/${ACCOUNT}?done=link_sent`);
  });

  it('refuses an id that is not one, so nothing else reaches the address', () => {
    expect(() => doneTo('../x', 'link_sent')).toThrow();
  });

  it('reads back only a code it knows, and each code has its line', () => {
    expect(doneOf({ done: 'rerun_queued' })).toBe('rerun_queued');
    expect(doneOf({ done: 'nope' })).toBeNull();
    expect(doneOf({ done: ['rerun_queued'] })).toBeNull();
    expect(doneOf({})).toBeNull();
    for (const code of DONE_CODES) expect(DONE_LINES[code].trim(), code).not.toBe('');
  });
});
