import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const x = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x!;
const base = { WORKER_SIGNING_SECRET: 's'.repeat(32), WORKER_JWT_PUBLIC_KEY: x };

describe('LAB_HOST_POLITENESS (F-018)', () => {
  it.each([
    ['unset', {}, false],
    ['1 on staging', { LAB_HOST_POLITENESS: '1', FLY_APP_NAME: 'crawlmouse-worker-staging' }, true],
    [
      '1 with whitespace',
      { LAB_HOST_POLITENESS: ' 1 ', FLY_APP_NAME: 'crawlmouse-worker-staging' },
      true,
    ],
    ['true', { LAB_HOST_POLITENESS: 'true', FLY_APP_NAME: 'crawlmouse-worker-staging' }, false],
    ['0', { LAB_HOST_POLITENESS: '0', FLY_APP_NAME: 'crawlmouse-worker-staging' }, false],
    [
      '1 on the production app',
      { LAB_HOST_POLITENESS: '1', FLY_APP_NAME: 'crawlmouse-worker' },
      false,
    ],
    ['1 with no app name', { LAB_HOST_POLITENESS: '1' }, false],
    [
      '1 on a renamed app',
      { LAB_HOST_POLITENESS: '1', FLY_APP_NAME: 'crawlmouse-worker-2' },
      false,
    ],
    [
      '1 on a differently cased name',
      { LAB_HOST_POLITENESS: '1', FLY_APP_NAME: 'Crawlmouse-Worker-Staging' },
      false,
    ],
  ])('%s', (_name, env, on) => {
    expect(loadConfig({ ...base, ...env }).labHostPoliteness).toBe(on);
  });
});
