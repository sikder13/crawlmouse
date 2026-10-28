import { createHmac, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { claims, keyPair, signJwt } from '../test-support/jwt.js';
import {
  MAX_SKEW_MS,
  signBatch,
  signRead,
  verifyBatchSignature,
  verifyReadSignature,
} from './hmac.js';
import { MAX_JWT_LIFETIME_S, verifyBatchJwt } from './jwt.js';
import { MAX_NONCES, NONCE_TTL_MS, Nonces } from './nonces.js';

const SECRET = 's'.repeat(40);
const NOW = 1_800_000_000_000;
const msg = { ts: String(NOW), checkId: 'c', batch: 3, nonce: 'n', body: '{"a":1}' };

describe('batch HMAC', () => {
  it('is hmac-sha256 over ts.check_id.batch.nonce.body, computed independently here', () => {
    const expected = createHmac('sha256', SECRET).update(`${NOW}.c.3.n.{"a":1}`).digest('hex');
    expect(signBatch(SECRET, msg)).toBe(expected);
  });

  it('accepts a correct signature and rejects any changed field', () => {
    const sig = signBatch(SECRET, msg);
    expect(verifyBatchSignature(SECRET, msg, sig, NOW)).toBeNull();
    for (const changed of [{ checkId: 'd' }, { batch: 4 }, { nonce: 'm' }, { body: '{"a":2}' }]) {
      expect(verifyBatchSignature(SECRET, { ...msg, ...changed }, sig, NOW)).toBe('bad_signature');
    }
    expect(verifyBatchSignature('t'.repeat(40), msg, sig, NOW)).toBe('bad_signature');
    expect(verifyBatchSignature(SECRET, msg, 'zz', NOW)).toBe('bad_signature');
  });

  it('enforces the window on both sides, to the millisecond', () => {
    const at = (ts: number) => ({ ...msg, ts: String(ts) });
    const ok = (ts: number) => verifyBatchSignature(SECRET, at(ts), signBatch(SECRET, at(ts)), NOW);
    expect(ok(NOW - MAX_SKEW_MS)).toBeNull();
    expect(ok(NOW + MAX_SKEW_MS)).toBeNull();
    expect(ok(NOW - MAX_SKEW_MS - 1)).toBe('stale_ts');
    expect(ok(NOW + MAX_SKEW_MS + 1)).toBe('stale_ts');
  });

  it.each(['', 'abc', '1.5', '-1', '1e12', ' 123'])('rejects the timestamp %j', (ts) => {
    expect(
      verifyBatchSignature(SECRET, { ...msg, ts }, signBatch(SECRET, { ...msg, ts }), NOW),
    ).toBe('bad_ts');
  });
});

describe('read signatures', () => {
  it('bind the purpose: a signature for one batch does not read another', () => {
    const ts = String(NOW);
    const sig = signRead(SECRET, ts, 'batch:a:1');
    expect(verifyReadSignature(SECRET, ts, 'batch:a:1', sig, NOW)).toBeNull();
    expect(verifyReadSignature(SECRET, ts, 'batch:a:2', sig, NOW)).toBe('bad_signature');
    expect(verifyReadSignature(SECRET, ts, 'metrics', sig, NOW)).toBe('bad_signature');
  });
});

describe('nonces', () => {
  it('accepts a nonce once and refuses it for the whole TTL, which outlives the signature window', () => {
    let t = NOW;
    const nonces = new Nonces(() => t);
    expect(nonces.claim('a')).toBe(true);
    expect(nonces.claim('a')).toBe(false);
    t += NONCE_TTL_MS;
    expect(nonces.claim('a')).toBe(false);
    t += 1;
    expect(nonces.claim('a')).toBe(true);
    // A timestamp verifies for 2 x MAX_SKEW_MS in all; the nonce must be remembered at least that long.
    expect(NONCE_TTL_MS).toBeGreaterThanOrEqual(2 * MAX_SKEW_MS);
  });

  it('is bounded, forgetting the oldest first', () => {
    const nonces = new Nonces(() => NOW);
    for (let i = 0; i <= MAX_NONCES; i++) nonces.claim(`n${i}`);
    expect(nonces.claim('n0')).toBe(true);
    expect(nonces.claim(`n${MAX_NONCES}`)).toBe(false);
  });
});

describe('batch JWT (Ed25519)', () => {
  const { publicKey, privateKey } = keyPair();
  const verifyAt = (token: string, now = NOW) => verifyBatchJwt(token, publicKey, now);

  it('verifies a good token and returns its claims', () => {
    const r = verifyAt(signJwt(privateKey, claims({ now: NOW })));
    expect(r).toMatchObject({ ok: true, claims: { site_host: 'example.com', batch: 1 } });
  });

  it('refuses a token signed by another key', () => {
    expect(verifyAt(signJwt(keyPair().privateKey, claims({ now: NOW })))).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('refuses a payload changed after signing', () => {
    const [h, , s] = signJwt(privateKey, claims({ now: NOW })).split('.');
    const forged = Buffer.from(
      JSON.stringify(claims({ now: NOW, site_id: '00000000-0000-4000-8000-0000000000ff' })),
    ).toString('base64url');
    expect(verifyAt(`${h}.${forged}.${s}`)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it.each([{ alg: 'none' }, { alg: 'HS256' }, { alg: 'RS256' }, {}])(
    'refuses the header %j',
    (header) => {
      expect(verifyAt(signJwt(privateKey, claims({ now: NOW }), header))).toEqual({
        ok: false,
        reason: 'bad_alg',
      });
    },
  );

  it('expires at exp, to the second', () => {
    const c = claims({ now: NOW });
    expect(verifyAt(signJwt(privateKey, c), c.exp * 1000 - 1).ok).toBe(true);
    expect(verifyAt(signJwt(privateKey, c), c.exp * 1000)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('refuses a token issued in the future or meant to live longer than an hour', () => {
    const iat = Math.floor(NOW / 1000);
    expect(verifyAt(signJwt(privateKey, claims({ iat: iat + 120, exp: iat + 600 })))).toEqual({
      ok: false,
      reason: 'not_yet_valid',
    });
    expect(
      verifyAt(signJwt(privateKey, claims({ iat, exp: iat + MAX_JWT_LIFETIME_S + 1 }))),
    ).toEqual({ ok: false, reason: 'too_long_lived' });
  });

  it.each([
    [
      'two check ids',
      {
        check_id: ['00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000ca'],
      },
    ],
    ['two site ids', { site_id: ['00000000-0000-4000-8000-0000000000a9'] }],
    ['an extra claim', { scope: 'all' }],
    ['another audience', { aud: 'crawlmouse-app' }],
    ['another role', { role: 'admin' }],
    ['a host with a port', { site_host: 'example.com:8080' }],
  ])('refuses claims with %s', (_name, over) => {
    expect(verifyAt(signJwt(privateKey, { ...claims({ now: NOW }), ...over }))).toEqual({
      ok: false,
      reason: 'bad_claims',
    });
  });

  it('refuses a payload with a __proto__ key', () => {
    const header = Buffer.from('{"alg":"EdDSA"}').toString('base64url');
    const payload = Buffer.from(
      `{"__proto__":{"x":1},${JSON.stringify(claims({ now: NOW })).slice(1)}`,
    ).toString('base64url');
    const sig = sign(null, Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
    expect(verifyAt(`${header}.${payload}.${sig}`)).toEqual({ ok: false, reason: 'malformed' });
  });

  it.each(['', 'a.b', 'a.b.c.d', '!!.??.**'])('refuses the malformed token %j', (token) => {
    expect(verifyAt(token)).toEqual({ ok: false, reason: 'malformed' });
  });
});
