import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { JWT_AUDIENCE, type BatchClaims } from '../auth/jwt.js';

/** The app's side of the per-batch JWT, for tests: a key pair and a signer. */
export function keyPair(): { publicKey: KeyObject; privateKey: KeyObject; publicKeyEnv: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x!;
  return { publicKey, privateKey, publicKeyEnv: x };
}

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

export function signJwt(
  privateKey: KeyObject,
  payload: unknown,
  header: unknown = { alg: 'EdDSA', typ: 'JWT' },
): string {
  const signing = `${b64(header)}.${b64(payload)}`;
  return `${signing}.${sign(null, Buffer.from(signing), privateKey).toString('base64url')}`;
}

export function claims({
  now = Date.now(),
  ...rest
}: Partial<BatchClaims> & { now?: number } = {}): BatchClaims {
  const iat = Math.floor(now / 1000);
  return {
    aud: JWT_AUDIENCE,
    role: 'crawl_worker',
    check_id: '00000000-0000-4000-8000-0000000000c9',
    site_id: '00000000-0000-4000-8000-0000000000a9',
    site_host: 'example.com',
    batch: 1,
    nonce: 'nonce-0000000000000001',
    iat,
    exp: iat + 900,
    ...rest,
  };
}
