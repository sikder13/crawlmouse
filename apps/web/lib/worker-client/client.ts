/**
 * The app's client for the crawl worker (CC-20b D2). Workstream B implements it.
 */
import type { KeyObject } from 'node:crypto';
import type { WorkerClient } from './types';

export interface WorkerClientOptions {
  /** The worker's base URL, no trailing slash. */
  url: string;
  signingSecret: string;
  /** The app's Ed25519 private key, which signs each batch's JWT. */
  privateKey: KeyObject;
  fetch?: typeof fetch;
  /** Milliseconds since the epoch. */
  now?: () => number;
  /** Per request. */
  timeoutMs?: number;
}

export function createWorkerClient(_opts: WorkerClientOptions): WorkerClient {
  throw new Error('createWorkerClient: workstream B implements this');
}

/** A client from CRAWL_WORKER_URL, WORKER_SIGNING_SECRET and WORKER_JWT_PRIVATE_KEY_PKCS8_B64; null when any is missing. */
export function workerClientFromEnv(_env: Record<string, string | undefined>): WorkerClient | null {
  throw new Error('workerClientFromEnv: workstream B implements this');
}
