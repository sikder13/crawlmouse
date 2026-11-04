import { createPublicKey, type KeyObject } from 'node:crypto';
import { RELEASE } from './release.js';
import { vantageOf, type Vantage } from './vantage.js';

/**
 * Configuration, from the environment only. The worker holds one secret, the HMAC signing secret it
 * shares with the app, and the app's Ed25519 public key for batch JWTs, which is not a secret. It is
 * given no database key and no Inngest key.
 */

export interface WorkerConfig {
  port: number;
  signingSecret: string;
  jwtPublicKey: KeyObject;
  /**
   * Batches run at once (BATCH_CONCURRENCY). Default 2: on one shared vCPU the reader thread keeps
   * request timers honest but adds no CPU, so more batches only queue behind each other's pages.
   */
  batchConcurrency: number;
  /** CRAWL_PAUSED, read the way the app reads it (apps/web/lib/crawl-pause.ts): only `1`, whitespace ignored. */
  paused: boolean;
  /** Where requests leave from (FLY_REGION, FLY_MACHINE_ID) and the build; see vantage.ts. */
  vantage: Vantage;
}

export const MIN_SECRET_LENGTH = 32;
export const DEFAULT_BATCH_CONCURRENCY = 2;
/** The most BATCH_CONCURRENCY may set: src/load.test.ts measures four batches at once in the VM. */
export const MAX_BATCH_CONCURRENCY = 4;

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
    batchConcurrency: intIn(
      env.BATCH_CONCURRENCY,
      DEFAULT_BATCH_CONCURRENCY,
      1,
      MAX_BATCH_CONCURRENCY,
      'BATCH_CONCURRENCY',
    ),
    paused: isCrawlPaused(env),
    vantage: vantageOf(env, RELEASE),
  };
}
