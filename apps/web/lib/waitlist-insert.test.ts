import { describe, it, expect } from 'vitest';
import { classifyWaitlistInsert } from './waitlist-insert';

describe('classifyWaitlistInsert', () => {
  it('treats no error as a successful insert (200)', () => {
    expect(classifyWaitlistInsert(null)).toEqual({ ok: true, status: 200 });
  });

  it('treats a 23505 unique-violation as idempotent success (200)', () => {
    // A repeat signup hits the (lower(email), source) unique index. We must NOT 500 it,
    // and we must NOT reveal that the email already existed (no enumeration).
    expect(classifyWaitlistInsert({ code: '23505' })).toEqual({ ok: true, status: 200 });
  });

  it('treats any other Postgres error code as a real failure (500)', () => {
    expect(classifyWaitlistInsert({ code: '23503' })).toEqual({ ok: false, status: 500 });
  });

  it('treats an error object with no code as a real failure (500)', () => {
    expect(classifyWaitlistInsert({})).toEqual({ ok: false, status: 500 });
  });
});
