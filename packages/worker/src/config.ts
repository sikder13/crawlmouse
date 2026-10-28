import { createPublicKey, type KeyObject } from 'node:crypto';

/**
 * Configuration, from the environment only. The worker holds one secret, the HMAC signing secret it
 * shares with the app, and the app's Ed25519 public key for batch JWTs, which is not a secret. It is
 * given no database key and no Inngest key.
 */

export interface WorkerConfig {
  port: number;
  signingSecret: string;
  jwtPublicKey: KeyObject;
  maxConcurrentBatches: number;
  /** CRAWL_PAUSED, read the way the app reads it (apps/web/lib/crawl-pause.ts): only `1`, whitespace ignored. */
  paused: boolean;
}

export const MIN_SECRET_LENGTH = 32;

type Env = Readonly<Record<string, string | undefined>>;

export const isCrawlPaused = (env: Env): boolean => env.CRAWL_PAUSED?.trim() === '1';

function intIn(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return n;
}

export function loadConfig(env: Env): WorkerConfig {
  const signingSecret = env.WORKER_SIGNING_SECRET ?? '';
  if (signingSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(`WORKER_SIGNING_SECRET is required, at least ${MIN_SECRET_LENGTH} characters`);
  }
  const x = env.WORKER_JWT_PUBLIC_KEY ?? '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(x)) {
    throw new Error(
      'WORKER_JWT_PUBLIC_KEY is required: the raw 32-byte Ed25519 public key, base64url',
    );
  }
  return {
    port: intIn(env.PORT, 8080, 1, 65535, 'PORT'),
    signingSecret,
    jwtPublicKey: createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' }),
    maxConcurrentBatches: intIn(env.MAX_CONCURRENT_BATCHES, 4, 1, 20, 'MAX_CONCURRENT_BATCHES'),
    paused: isCrawlPaused(env),
  };
}
