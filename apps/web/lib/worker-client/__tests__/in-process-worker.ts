/**
 * Test support, never imported by app code: the crawl worker's own HTTP service
 * (packages/worker/src/server.ts) started in this process on a loopback port, with a planted signing
 * secret and a fresh Ed25519 key pair. The client is then proven against the worker's own checks,
 * not against a copy of them. Pages are answered by the worker's fake fetcher, so no request leaves
 * the machine; the worker's clock is virtual, so a client under test reads `clock.now()`.
 */
import { generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { loadConfig, type WorkerConfig } from '../../../../../packages/worker/src/config';
import type { Fetcher } from '../../../../../packages/worker/src/fetch/fetcher';
import { createWorker, type Worker } from '../../../../../packages/worker/src/server';
import { InstantClock } from '../../../../../packages/worker/src/test-support/clock';
import { fakeFetcher } from '../../../../../packages/worker/src/test-support/fake-fetcher';

export interface InProcessWorker {
  base: string;
  clock: InstantClock;
  worker: Worker;
  /** The planted values the client signs with. */
  signingSecret: string;
  privateKey: KeyObject;
  privateKeyB64: string;
  stop(): Promise<void>;
}

/** A planted secret: random, so no fixture string can match it by accident. */
export const plantedSecret = (): string => `planted-${randomBytes(24).toString('hex')}`;

/** Every page answers 200 with a small HTML body; robots.txt answers 404. */
export const pageFetcher = (clock: InstantClock): Fetcher =>
  fakeFetcher(clock, (url) =>
    url.endsWith('/robots.txt')
      ? { status: 404, body: '' }
      : { status: 200, body: '<html><body><a href="/next">next</a></body></html>' },
  );

export async function startWorker(
  over: Partial<WorkerConfig> = {},
  fetcher?: (clock: InstantClock) => Fetcher,
): Promise<InProcessWorker> {
  const clock = new InstantClock(1_800_000_000_000);
  const signingSecret = plantedSecret();
  const pair = generateKeyPairSync('ed25519');
  const config: WorkerConfig = {
    ...loadConfig({
      WORKER_SIGNING_SECRET: signingSecret,
      WORKER_JWT_PUBLIC_KEY: pair.publicKey.export({ format: 'jwk' }).x!,
    }),
    ...over,
  };
  const worker = createWorker({
    config,
    clock,
    fetcher: (fetcher ?? pageFetcher)(clock),
    log: () => undefined,
  });
  await new Promise<void>((r) => worker.server.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${(worker.server.address() as AddressInfo).port}`,
    clock,
    worker,
    signingSecret,
    privateKey: pair.privateKey,
    privateKeyB64: pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    stop: async () => {
      await worker.idle();
      worker.server.closeAllConnections();
      await new Promise<void>((r) => worker.server.close(() => r()));
    },
  };
}
