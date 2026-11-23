/**
 * `lib/analytics-server.ts` imports PostHog's bot list from a path inside the package, not from its
 * public entry. An upgrade can move that file, so this names the failure instead of leaving it to
 * surface as a server event that stops being filtered or a route that will not load.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PATH = 'posthog-js/lib/src/utils/blocked-uas';
const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

describe('the PostHog bot list import', () => {
  it(`${PATH} still resolves and exports isBlockedUA`, () => {
    const load = createRequire(import.meta.url);
    const mod = load(PATH) as { isBlockedUA?: unknown };
    expect(typeof mod.isBlockedUA, `${PATH} no longer exports isBlockedUA`).toBe('function');
  });

  it('still tells a crawler from a browser', () => {
    const load = createRequire(import.meta.url);
    const { isBlockedUA } = load(PATH) as {
      isBlockedUA: (ua: string, custom: string[]) => boolean;
    };
    expect(isBlockedUA('Mozilla/5.0 (compatible; Googlebot/2.1)', [])).toBe(true);
    expect(isBlockedUA(CHROME, [])).toBe(false);
  });

  it('the server sender imports it from that path', () => {
    const source = readFileSync(resolve(__dirname, '../lib/analytics-server.ts'), 'utf8');
    expect(source).toContain(`from '${PATH}'`);
  });
});
