import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

// F-332: the production worker had no APP_SIGNAL_URL, so it sent no done signal and every production
// batch was polled. Both Fly files now carry production's route under [env]; the staging worker's
// Fly secret of the same name takes its place there (docs/ops/worker-runbook.md, "The done signal").

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
/** Production's signal route, written out: the apex, because the worker refuses a redirect. */
const PRODUCTION_ROUTE = 'https://crawlmouse.com/api/webhooks/worker';

/** The `[env]` line's value in a Fly file, read from the file; null when it has none. */
function signalUrlIn(toml: string): string | null {
  const env = /\n\[env\]\n((?:(?!\n\[).)*)/s.exec(toml)?.[1] ?? '';
  const lines = [...env.matchAll(/^ {2}APP_SIGNAL_URL = "([^"]*)"$/gm)];
  expect(lines.length).toBeLessThanOrEqual(1);
  return lines[0]?.[1] ?? null;
}

const x = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x!;
const secrets = { WORKER_SIGNING_SECRET: 's'.repeat(32), WORKER_JWT_PUBLIC_KEY: x };

describe("the production worker's signal address (F-332)", () => {
  it.each(['../fly.production.toml', '../fly.toml'])(
    '%s sets APP_SIGNAL_URL under [env] to the production route',
    (file) => {
      expect(signalUrlIn(read(file))).toBe(PRODUCTION_ROUTE);
    },
  );

  it('is the apex over https with no path past the route: www answers 308, which the worker refuses', () => {
    const u = new URL(PRODUCTION_ROUTE);
    expect([u.protocol, u.hostname, u.pathname, u.search]).toEqual([
      'https:',
      'crawlmouse.com',
      '/api/webhooks/worker',
      '',
    ]);
  });

  it('turns the signal on in the production config, with no bypass and no lab politeness', () => {
    const config = loadConfig({
      ...secrets,
      FLY_APP_NAME: 'crawlmouse-worker',
      APP_SIGNAL_URL: signalUrlIn(read('../fly.production.toml'))!,
      // Both are staging-only: the production worker ignores them even if they were set.
      APP_SIGNAL_PROTECTION_BYPASS: 'b'.repeat(32),
      LAB_HOST_POLITENESS: '1',
    });
    expect(config.appSignalUrl).toBe(PRODUCTION_ROUTE);
    expect(config.appSignalBypass).toBeNull();
    expect(config.labHostPoliteness).toBe(false);
  });

  it('reads a secret that is no https address, as the runbook turns it off, as unset', () => {
    expect(loadConfig({ ...secrets, APP_SIGNAL_URL: 'off' }).appSignalUrl).toBeNull();
  });
});
