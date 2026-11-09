import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyBatchJwt } from '../../../../packages/worker/src/auth/jwt';
import { loadPrivateKey, mintBatchJwt, PRIVATE_KEY_ENV } from './jwt';

const NOW = 1_800_000_000_123;
const pair = generateKeyPairSync('ed25519');
const b64 = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const fields = {
  check_id: '00000000-0000-4000-8000-0000000000c9',
  site_id: '00000000-0000-4000-8000-0000000000a9',
  site_host: 'example.com',
  batch: 7,
  nonce: 'nonce-0123456789abcdef',
};

const part = (token: string, i: number): unknown =>
  JSON.parse(Buffer.from(token.split('.')[i]!, 'base64url').toString('utf8'));

describe('loadPrivateKey', () => {
  it('loads base64 PKCS8 DER of an Ed25519 key', () => {
    const key = loadPrivateKey(b64);
    expect(key.type).toBe('private');
    expect(key.asymmetricKeyType).toBe('ed25519');
  });

  const refused: Array<[string, string]> = [
    [
      'an RSA key',
      generateKeyPairSync('rsa', { modulusLength: 2048 })
        .privateKey.export({ format: 'der', type: 'pkcs8' })
        .toString('base64'),
    ],
    [
      'an X25519 key',
      generateKeyPairSync('x25519')
        .privateKey.export({ format: 'der', type: 'pkcs8' })
        .toString('base64'),
    ],
    ['the PEM text', pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()],
    ['not a key', Buffer.from('planted-not-a-key-0123456789').toString('base64')],
    ['empty', ''],
  ];
  it.each(refused)('refuses %s, naming the variable and not the value', (_, value) => {
    let thrown: unknown;
    try {
      loadPrivateKey(value);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const err = thrown as Error;
    expect(err.message).toContain(PRIVATE_KEY_ENV);
    expect(PRIVATE_KEY_ENV).toBe('WORKER_JWT_PRIVATE_KEY_PKCS8_B64');
    for (const text of [err.message, String(err), err.stack ?? '', JSON.stringify(err)]) {
      if (value) expect(text).not.toContain(value);
    }
    expect(err.cause).toBeUndefined();
  });
});

describe('mintBatchJwt', () => {
  it("passes the worker's own verification, with exactly the claims it requires, in order", () => {
    const token = mintBatchJwt(loadPrivateKey(b64), fields, NOW);
    const verified = verifyBatchJwt(token, pair.publicKey, NOW);
    expect(verified.ok).toBe(true);
    const iat = 1_800_000_000;
    const payload = part(token, 1);
    expect(payload).toEqual({
      aud: 'crawlmouse-worker',
      role: 'crawl_worker',
      ...fields,
      iat,
      exp: iat + 900,
    });
    expect(Object.keys(payload as object)).toEqual([
      'aud',
      'role',
      'check_id',
      'site_id',
      'site_host',
      'batch',
      'nonce',
      'iat',
      'exp',
    ]);
    expect(part(token, 0)).toEqual({ alg: 'EdDSA', typ: 'JWT' });
  });

  it('takes no field the caller passes beyond the five it names', () => {
    const token = mintBatchJwt(
      pair.privateKey,
      { ...fields, role: 'admin', extra: 1 } as typeof fields,
      NOW,
    );
    expect(verifyBatchJwt(token, pair.publicKey, NOW).ok).toBe(true);
    expect(part(token, 1)).not.toHaveProperty('extra');
  });

  it('lives ttlS seconds, at most an hour', () => {
    const iat = Math.floor(NOW / 1000);
    const hour = mintBatchJwt(pair.privateKey, fields, NOW, 3600);
    expect(part(hour, 1)).toMatchObject({ iat, exp: iat + 3600 });
    expect(verifyBatchJwt(hour, pair.publicKey, NOW).ok).toBe(true);
    for (const ttl of [3601, 0, -1, 1.5, Number.NaN]) {
      expect(() => mintBatchJwt(pair.privateKey, fields, NOW, ttl)).toThrow(/ttl/i);
    }
  });

  it('refuses a site_host with a port or upper case, which the worker would refuse', () => {
    for (const site_host of [
      'example.com:8443',
      'Example.com',
      'EXAMPLE.COM',
      'https://example.com',
      '',
    ]) {
      expect(() => mintBatchJwt(pair.privateKey, { ...fields, site_host }, NOW)).toThrow(
        /site_host/,
      );
    }
    for (const site_host of ['example.com', 'www.example.co.uk', 'a-b.example']) {
      const token = mintBatchJwt(pair.privateKey, { ...fields, site_host }, NOW);
      expect(verifyBatchJwt(token, pair.publicKey, NOW).ok).toBe(true);
    }
  });

  it('refuses a key that is not an Ed25519 private key', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expect(() => mintBatchJwt(rsa, fields, NOW)).toThrow(/Ed25519/);
    expect(() => mintBatchJwt(pair.publicKey, fields, NOW)).toThrow(/Ed25519/);
  });
});
