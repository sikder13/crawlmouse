import { describe, expect, it } from 'vitest';
import { parseArgs } from './cli';

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
