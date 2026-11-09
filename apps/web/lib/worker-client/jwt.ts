import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

/**
 * The per-batch JWT the crawl worker requires (packages/worker/src/auth/jwt.ts): EdDSA over Ed25519,
 * signed with the app's private key; the worker holds only the public key. The claims are strict on
 * the worker's side, so this sends exactly its nine and no others.
 */

export const PRIVATE_KEY_ENV = 'WORKER_JWT_PRIVATE_KEY_PKCS8_B64';
export const JWT_AUDIENCE = 'crawlmouse-worker';
export const JWT_ROLE = 'crawl_worker';
export const DEFAULT_JWT_TTL_S = 900;
/** The worker refuses a token that lives longer. */
export const MAX_JWT_TTL_S = 3600;
const SITE_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

/** The worker's `site_host` rule (BatchClaimsSchema): a lower-case DNS name, no port, no scheme. */
export const isSiteHost = (host: string): boolean => host.length <= 253 && SITE_HOST.test(host);

/** What one batch's token names; `batch` and `nonce` must equal the body's. */
export interface BatchJwtFields {
  check_id: string;
  site_id: string;
  /** Lower case, no port: every URL in the batch must be on it. */
  site_host: string;
  batch: number;
  nonce: string;
}

const isEd25519Private = (key: KeyObject): boolean =>
  key.type === 'private' && key.asymmetricKeyType === 'ed25519';

/**
 * The private key from its environment form: base64 of PKCS8 DER. An error names the variable and
 * never carries the value or the parser's own error.
 */
export function loadPrivateKey(b64: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8' });
  } catch {
    throw new Error(`${PRIVATE_KEY_ENV} is not a base64 PKCS8 DER private key`);
  }
  if (!isEd25519Private(key)) throw new Error(`${PRIVATE_KEY_ENV} is not an Ed25519 private key`);
  return key;
}

const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

export function mintBatchJwt(
  key: KeyObject,
  fields: BatchJwtFields,
  nowMs: number,
  ttlS: number = DEFAULT_JWT_TTL_S,
): string {
  if (!isEd25519Private(key)) throw new Error('the batch JWT key must be an Ed25519 private key');
  if (!Number.isInteger(ttlS) || ttlS < 1 || ttlS > MAX_JWT_TTL_S) {
    throw new Error(
      `the batch JWT ttl must be a whole number of seconds from 1 to ${MAX_JWT_TTL_S}`,
    );
  }
  if (!isSiteHost(fields.site_host)) {
    throw new Error('site_host must be a lower-case host name with no port');
  }
  const iat = Math.floor(nowMs / 1000);
  const claims = {
    aud: JWT_AUDIENCE,
    role: JWT_ROLE,
    check_id: fields.check_id,
    site_id: fields.site_id,
    site_host: fields.site_host,
    batch: fields.batch,
    nonce: fields.nonce,
    iat,
    exp: iat + ttlS,
  };
  const signingInput = `${part({ alg: 'EdDSA', typ: 'JWT' })}.${part(claims)}`;
  return `${signingInput}.${sign(null, Buffer.from(signingInput), key).toString('base64url')}`;
}
