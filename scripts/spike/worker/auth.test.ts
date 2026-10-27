import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  MAX_SKEW_MS,
  NonceStore,
  signBatch,
  verifyBatch,
  signJwt,
  verifyJwt,
  signTs,
  verifyTs,
} from './auth.js';

// Test-only values. None of these is a credential of any system.
const SECRET = 'unit-test-signing-value-not-a-credential';
const JWT_SECRET = 'unit-test-jwt-value-not-a-credential';
const NOW = 1_800_000_000_000;

const base = { checkId: 'chk_0001', batch: 2, nonce: 'n-abcdefgh12', body: '{"k":1}' };

describe('batch HMAC', () => {
  it('matches an independently computed hmac-sha256 over ts.checkId.batch.nonce.body', () => {
    const sig = signBatch({ ...base, ts: String(NOW), secret: SECRET });
    const expected = createHmac('sha256', SECRET).update(`${NOW}.chk_0001.2.n-abcdefgh12.{"k":1}`).digest('hex');
    expect(sig).toBe(expected);
  });

  it('accepts a fresh, correctly signed request', () => {
    const ts = String(NOW);
    const signature = signBatch({ ...base, ts, secret: SECRET });
    expect(verifyBatch({ ...base, ts, signature, secret: SECRET, now: NOW })).toEqual({ ok: true });
  });

  it.each([
    ['body', { body: '{"k":2}' }],
    ['checkId', { checkId: 'chk_0002' }],
    ['batch', { batch: 3 }],
    ['nonce', { nonce: 'n-zzzzzzzz12' }],
  ])('rejects a signature when the %s differs', (_name, change) => {
    const ts = String(NOW);
    const signature = signBatch({ ...base, ts, secret: SECRET });
    const r = verifyBatch({ ...base, ...change, ts, signature, secret: SECRET, now: NOW });
    expect(r).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a different secret and a malformed signature without throwing', () => {
    const ts = String(NOW);
    const signature = signBatch({ ...base, ts, secret: 'other' });
    expect(verifyBatch({ ...base, ts, signature, secret: SECRET, now: NOW })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyBatch({ ...base, ts, signature: 'zz', secret: SECRET, now: NOW })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyBatch({ ...base, ts, signature: '', secret: SECRET, now: NOW })).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('enforces the 5 minute window on both sides, to the millisecond', () => {
    const at = (offset: number) => {
      const ts = String(NOW + offset);
      const signature = signBatch({ ...base, ts, secret: SECRET });
      return verifyBatch({ ...base, ts, signature, secret: SECRET, now: NOW });
    };
    expect(MAX_SKEW_MS).toBe(5 * 60_000);
    expect(at(-MAX_SKEW_MS)).toEqual({ ok: true });
    expect(at(-MAX_SKEW_MS - 1)).toEqual({ ok: false, reason: 'stale_ts' });
    expect(at(MAX_SKEW_MS)).toEqual({ ok: true });
    expect(at(MAX_SKEW_MS + 1)).toEqual({ ok: false, reason: 'stale_ts' });
  });

  it.each(['', 'abc', '1.5', '-1', '1e12', ' 123'])('rejects a malformed timestamp %j', (ts) => {
    const signature = signBatch({ ...base, ts, secret: SECRET });
    expect(verifyBatch({ ...base, ts, signature, secret: SECRET, now: NOW })).toEqual({ ok: false, reason: 'bad_ts' });
  });
});

describe('nonce replay', () => {
  it('accepts a nonce once and refuses it afterwards', () => {
    const s = new NonceStore({ ttlMs: 10 * 60_000, now: () => NOW });
    expect(s.claim('a')).toBe(true);
    expect(s.claim('a')).toBe(false);
    expect(s.claim('b')).toBe(true);
  });

  it('forgets a nonce only after the ttl, which must outlive the signature window', () => {
    let t = NOW;
    const s = new NonceStore({ ttlMs: 2 * MAX_SKEW_MS, now: () => t });
    s.claim('a');
    t += 2 * MAX_SKEW_MS - 1;
    expect(s.claim('a')).toBe(false);
    t += 2;
    expect(s.claim('a')).toBe(true);
  });

  it('refuses to be built with a ttl shorter than the signature window', () => {
    expect(() => new NonceStore({ ttlMs: MAX_SKEW_MS - 1, now: () => NOW })).toThrow(/ttl/i);
  });

  it('is bounded: the oldest entries are evicted past maxEntries', () => {
    const s = new NonceStore({ ttlMs: 2 * MAX_SKEW_MS, now: () => NOW, maxEntries: 3 });
    for (const n of ['a', 'b', 'c', 'd']) s.claim(n);
    expect(s.size()).toBe(3);
  });
});

describe('per-batch JWT', () => {
  const claims = { check_id: 'chk_0001', batch: 2, nonce: 'n-abcdefgh12', role: 'crawl_worker' as const };
  const mk = (over: Record<string, unknown> = {}, exp = NOW / 1000 + 900) =>
    signJwt({ ...claims, iat: NOW / 1000, exp, ...over }, JWT_SECRET);
  const expectBatch = { check_id: 'chk_0001', batch: 2, nonce: 'n-abcdefgh12' };

  it('verifies a good token and returns its claims', () => {
    const r = verifyJwt(mk(), JWT_SECRET, { now: NOW, expect: expectBatch });
    expect(r.ok).toBe(true);
  });

  it('rejects an expired token, at the second boundary', () => {
    const t = mk({}, NOW / 1000 + 10);
    expect(verifyJwt(t, JWT_SECRET, { now: NOW + 9_999, expect: expectBatch }).ok).toBe(true);
    expect(verifyJwt(t, JWT_SECRET, { now: NOW + 10_000, expect: expectBatch })).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token for batch 2 presented as batch 3', () => {
    const r = verifyJwt(mk(), JWT_SECRET, { now: NOW, expect: { ...expectBatch, batch: 3 } });
    expect(r).toEqual({ ok: false, reason: 'claim_mismatch' });
  });

  it('rejects another check and another nonce', () => {
    expect(verifyJwt(mk(), JWT_SECRET, { now: NOW, expect: { ...expectBatch, check_id: 'chk_9' } })).toEqual({ ok: false, reason: 'claim_mismatch' });
    expect(verifyJwt(mk(), JWT_SECRET, { now: NOW, expect: { ...expectBatch, nonce: 'other-nonce-1' } })).toEqual({ ok: false, reason: 'claim_mismatch' });
  });

  it('rejects the wrong role', () => {
    expect(verifyJwt(mk({ role: 'service_role' }), JWT_SECRET, { now: NOW, expect: expectBatch })).toEqual({ ok: false, reason: 'wrong_role' });
  });

  it('rejects a token without exp', () => {
    const t = signJwt({ ...claims, iat: NOW / 1000 }, JWT_SECRET);
    expect(verifyJwt(t, JWT_SECRET, { now: NOW, expect: expectBatch })).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a bad signature and the wrong secret', () => {
    const t = mk();
    expect(verifyJwt(t, 'other', { now: NOW, expect: expectBatch })).toEqual({ ok: false, reason: 'bad_signature' });
    const [h, p, s] = t.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...claims, batch: 3, exp: NOW / 1000 + 900 })).toString('base64url')}.${s}`;
    expect(p).not.toBe(forged.split('.')[1]);
    expect(verifyJwt(forged, JWT_SECRET, { now: NOW, expect: { ...expectBatch, batch: 3 } })).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects alg none and any alg other than HS256, and malformed tokens', () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const payload = b64({ ...claims, exp: NOW / 1000 + 900 });
    expect(verifyJwt(`${b64({ alg: 'none', typ: 'JWT' })}.${payload}.`, JWT_SECRET, { now: NOW, expect: expectBatch })).toEqual({ ok: false, reason: 'bad_alg' });
    expect(verifyJwt(`${b64({ alg: 'HS512', typ: 'JWT' })}.${payload}.AAAA`, JWT_SECRET, { now: NOW, expect: expectBatch })).toEqual({ ok: false, reason: 'bad_alg' });
    for (const junk of ['', 'a.b', 'a.b.c.d', '...', 'not a token']) {
      expect(verifyJwt(junk, JWT_SECRET, { now: NOW, expect: expectBatch }).ok).toBe(false);
    }
  });
});

describe('generic timestamped signature (metrics / results reads)', () => {
  it('binds the purpose string and the window', () => {
    const ts = String(NOW);
    const sig = signTs({ ts, purpose: 'metrics', secret: SECRET });
    expect(verifyTs({ ts, purpose: 'metrics', signature: sig, secret: SECRET, now: NOW })).toEqual({ ok: true });
    expect(verifyTs({ ts, purpose: 'results:x', signature: sig, secret: SECRET, now: NOW })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyTs({ ts, purpose: 'metrics', signature: sig, secret: SECRET, now: NOW + MAX_SKEW_MS + 1 })).toEqual({ ok: false, reason: 'stale_ts' });
  });
});
