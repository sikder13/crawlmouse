import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const BASE = {
  WORKER_SIGNING_SECRET: 's'.repeat(48),
  WORKER_JWT_PUBLIC_KEY: 'A'.repeat(43),
};
const BYPASS = 'b'.repeat(32);
const ON_STAGING = {
  ...BASE,
  FLY_APP_NAME: 'crawlmouse-worker-staging',
  APP_SIGNAL_URL: 'https://crawlmouse-001-env-staging.vercel.app/api/webhooks/worker',
  APP_SIGNAL_PROTECTION_BYPASS: BYPASS,
};

describe('the staging-only protection bypass for the done signal', () => {
  it('is read on the staging worker, for a Vercel address', () => {
    expect(loadConfig(ON_STAGING).appSignalBypass).toBe(BYPASS);
  });

  it('ignores whitespace around it', () => {
    const c = loadConfig({ ...ON_STAGING, APP_SIGNAL_PROTECTION_BYPASS: `  ${BYPASS}\n` });
    expect(c.appSignalBypass).toBe(BYPASS);
  });

  it.each([
    ['the production worker', { FLY_APP_NAME: 'crawlmouse-worker' }],
    ['a worker that names no app', { FLY_APP_NAME: undefined }],
    ['an empty value', { APP_SIGNAL_PROTECTION_BYPASS: '   ' }],
    ['no signal address', { APP_SIGNAL_URL: undefined }],
    ['the production address', { APP_SIGNAL_URL: 'https://crawlmouse.com/api/webhooks/worker' }],
    [
      'a host that only ends alike',
      { APP_SIGNAL_URL: 'https://evil-vercel.app/api/webhooks/worker' },
    ],
    [
      'a host with Vercel as a subdomain',
      { APP_SIGNAL_URL: 'https://x.vercel.app.evil.test/api/webhooks/worker' },
    ],
  ])('is not used on %s', (_name, over) => {
    expect(loadConfig({ ...ON_STAGING, ...over }).appSignalBypass).toBeNull();
  });
});
