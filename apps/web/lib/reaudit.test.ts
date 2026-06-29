import { describe, it, expect } from 'vitest';
import { authorizeReaudit } from './reaudit';

describe('authorizeReaudit (SPEC 02 §8 — Pro + OWNER gate, not an unmetered backdoor)', () => {
  const base = { userId: 'u1', auditExists: true, auditUserId: 'u1', isPro: true };

  it('allows a Pro owner', () => {
    expect(authorizeReaudit(base)).toEqual({ ok: true });
  });

  it('401 when not signed in', () => {
    const r = authorizeReaudit({ ...base, userId: null });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.status).toBe(401);
  });

  it('404 when the audit does not exist', () => {
    const r = authorizeReaudit({ ...base, auditExists: false, auditUserId: undefined });
    expect(r.ok === false && r.status).toBe(404);
  });

  it('403 when signed in but not the owner (owner-scoped, not just tier)', () => {
    const r = authorizeReaudit({ ...base, auditUserId: 'someone-else' });
    expect(r.ok === false && r.status).toBe(403);
  });

  it('402 when the owner is NOT Pro (re-audit/monitoring is a Pro feature)', () => {
    const r = authorizeReaudit({ ...base, isPro: false });
    expect(r.ok === false && r.status).toBe(402);
  });

  it('checks auth FIRST — an anonymous caller gets 401, never an existence leak', () => {
    const r = authorizeReaudit({ userId: null, auditExists: false, auditUserId: null, isPro: false });
    expect(r.ok === false && r.status).toBe(401);
  });
});
