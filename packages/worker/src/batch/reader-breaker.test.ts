import { describe, expect, it } from 'vitest';
import { HOST_READER_MS, ReaderBreaker, SLOW_READ_MS, SMALL_PAGE_CHARS } from './reader-breaker.js';

const A = 'https://a.example/page';
const A2 = 'https://a.example/other';
const B = 'https://b.example/page';
const small = SMALL_PAGE_CHARS - 1;

describe('the reader breaker', () => {
  it('starts closed', () => {
    expect(new ReaderBreaker().isOpen(A)).toBe(false);
  });

  it.each(['reader_thread_crashed', 'reader_deadline'] as const)(
    'opens for the host when a small page ends in %s',
    (failed) => {
      const b = new ReaderBreaker();
      b.record(A, small, { failed, readMs: 10 });
      expect(b.isOpen(A2)).toBe(true);
      expect(b.isOpen(B)).toBe(false);
    },
  );

  it('opens when a small page is slower than the bound, and not at it', () => {
    const at = new ReaderBreaker();
    at.record(A, small, { readMs: SLOW_READ_MS });
    expect(at.isOpen(A)).toBe(false);
    const past = new ReaderBreaker();
    past.record(A, small, { readMs: SLOW_READ_MS + 1 });
    expect(past.isOpen(A)).toBe(true);
  });

  it('counts a page of exactly the small size as large', () => {
    const b = new ReaderBreaker();
    b.record(A, SMALL_PAGE_CHARS, { failed: 'reader_thread_crashed', readMs: 10 });
    expect(b.isOpen(A)).toBe(false);
  });

  it('stays closed for one large page that crashes or is slow', () => {
    const b = new ReaderBreaker();
    b.record(A, SMALL_PAGE_CHARS * 8, { failed: 'reader_thread_crashed', readMs: 1_300 });
    b.record(A2, SMALL_PAGE_CHARS * 8, { readMs: 12_800 });
    expect(b.isOpen(A)).toBe(false);
  });

  it('opens once the host has used its reader time, failed reads included', () => {
    const b = new ReaderBreaker();
    const large = SMALL_PAGE_CHARS * 8;
    b.record(A, large, { readMs: HOST_READER_MS - 10 });
    b.record(A2, large, { readMs: 10 });
    expect(b.isOpen(A)).toBe(false);
    b.record(A, large, { failed: 'reader_deadline', readMs: 1 });
    expect(b.isOpen(A)).toBe(true);
  });

  it('keeps each host’s time apart', () => {
    const b = new ReaderBreaker();
    const large = SMALL_PAGE_CHARS * 8;
    b.record(A, large, { readMs: HOST_READER_MS - 1 });
    b.record(B, large, { readMs: HOST_READER_MS - 1 });
    expect(b.isOpen(A)).toBe(false);
    expect(b.isOpen(B)).toBe(false);
  });

  it('treats the host’s case as the same host, as a URL does', () => {
    const b = new ReaderBreaker();
    b.record('https://A.example/x', small, { failed: 'reader_thread_crashed', readMs: 1 });
    expect(b.isOpen('https://a.example/y')).toBe(true);
  });

  it('counts a read that reports no time as none', () => {
    const b = new ReaderBreaker();
    b.record(A, small, {});
    expect(b.isOpen(A)).toBe(false);
  });
});
