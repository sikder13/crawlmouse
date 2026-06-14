import { describe, it, expect } from 'vitest';
import { authorizeCancel } from './audit-cancel';

const owned = { user_id: 'u1', anonymous_session_id: null, status: 'crawling' };
const anon = { user_id: null, anonymous_session_id: 'sess-1', status: 'crawling' };

describe('authorizeCancel', () => {
  it('allows the owner of a logged-in audit', () => {
    expect(authorizeCancel(owned, { userId: 'u1', anonSessionId: null })).toEqual({ allowed: true });
  });

  it('forbids a different logged-in user (403)', () => {
    expect(authorizeCancel(owned, { userId: 'u2', anonSessionId: null })).toMatchObject({ allowed: false, status: 403 });
  });

  it('forbids an anonymous viewer on an owned audit (403)', () => {
    expect(authorizeCancel(owned, { userId: null, anonSessionId: 'sess-1' })).toMatchObject({ allowed: false, status: 403 });
  });

  it('allows the matching anon session on an anonymous audit', () => {
    expect(authorizeCancel(anon, { userId: null, anonSessionId: 'sess-1' })).toEqual({ allowed: true });
  });

  it('forbids a non-matching anon session (403)', () => {
    expect(authorizeCancel(anon, { userId: null, anonSessionId: 'other' })).toMatchObject({ allowed: false, status: 403 });
  });

  it('forbids when the requester has no anon session — cannot prove ownership of an anon audit (403)', () => {
    expect(authorizeCancel(anon, { userId: null, anonSessionId: null })).toMatchObject({ allowed: false, status: 403 });
  });

  it('forbids a logged-in user from canceling someone else’s anonymous audit (403)', () => {
    expect(authorizeCancel(anon, { userId: 'u9', anonSessionId: null })).toMatchObject({ allowed: false, status: 403 });
  });

  it('returns 409 not_cancelable when the audit is already terminal', () => {
    for (const status of ['completed', 'failed', 'canceled']) {
      expect(authorizeCancel({ ...owned, status }, { userId: 'u1', anonSessionId: null })).toMatchObject({ allowed: false, status: 409 });
    }
  });

  it('allows canceling a pending audit (not yet crawling)', () => {
    expect(authorizeCancel({ ...owned, status: 'pending' }, { userId: 'u1', anonSessionId: null })).toEqual({ allowed: true });
  });
});
