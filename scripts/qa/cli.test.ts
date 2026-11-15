import { describe, expect, it } from 'vitest';
import { main, parseArgs } from './cli';

/**
 * The QA command line's arguments only (CC-38 D1, D2); what each command does is the other tests'.
 *   pnpm --filter @crawlmouse/scripts exec vitest run qa/cli.test.ts
 */

describe('qa cli arguments', () => {
  it('reads seed, its two flags in either order, and reset', () => {
    expect(parseArgs(['seed'])).toEqual({ command: 'seed', billing: false, live: false });
    expect(parseArgs(['seed', '--billing'])).toEqual({
      command: 'seed',
      billing: true,
      live: false,
    });
    for (const argv of [
      ['seed', '--billing', '--live'],
      ['seed', '--live', '--billing'],
    ]) {
      expect(parseArgs(argv)).toEqual({ command: 'seed', billing: true, live: true });
    }
    expect(parseArgs(['reset'])).toEqual({ command: 'reset' });
  });

  it('skips the `--` pnpm passes through from the root script', () => {
    expect(parseArgs(['seed', '--', '--billing'])).toEqual({
      command: 'seed',
      billing: true,
      live: false,
    });
    expect(parseArgs(['reset', '--'])).toEqual({ command: 'reset' });
  });

  it('refuses --live without --billing, so live mode is never implied', () => {
    expect(parseArgs(['seed', '--live'])).toEqual({ error: '--live goes with --billing only' });
  });

  it('refuses an unknown command, an unknown or repeated flag, and a flag on reset', () => {
    for (const argv of [
      [],
      ['seeds'],
      ['seed', '--bill'],
      ['seed', '--LIVE', '--billing'],
      ['seed', '--billing', '--billing'],
      ['seed', 'billing'],
      ['reset', '--live'],
      ['reset', '--billing'],
    ]) {
      expect(parseArgs(argv)).toHaveProperty('error');
    }
  });
});

describe('qa cli: --billing checks its Stripe wiring before part (a) writes', () => {
  it('exits 2 when the billing deps are refused, and part (a) never runs', async () => {
    const touched: string[] = [];
    const errors: string[] = [];
    const { WiringError } = await import('./wiring');
    const fakeWire = (() => ({
      seed: new Proxy(
        {},
        {
          get(_t, prop) {
            touched.push(String(prop));
            throw new Error(`part (a) read ${String(prop)}`);
          },
        },
      ),
      reset: {},
      billing() {
        throw new WiringError('the production deployment and database bill in live mode only');
      },
    })) as unknown as NonNullable<Parameters<typeof main>[1]['wire']>;
    const code = await main(['seed', '--billing'], {
      env: {},
      print: () => {},
      error: (l) => errors.push(l),
      wire: fakeWire,
    });
    expect(code).toBe(2);
    expect(errors).toEqual(['the production deployment and database bill in live mode only']);
    expect(touched).toEqual([]);
  });
});
