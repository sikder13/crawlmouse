import { describe, expect, it } from 'vitest';
import { parseTokens } from '../../__tests__/v2/_lib/tokens-css';
import { MOTION, type MotionEntry } from './motion';

const ENTRIES = Object.entries(MOTION) as [string, MotionEntry][];

const tokens = new Map(
  parseTokens()
    .filter((t) => t.block === 'root')
    .map((t) => [t.name, t.value]),
);

/** "0.5s" or "500ms" as milliseconds. */
const ms = (v: string) =>
  v.endsWith('ms') ? Number(v.slice(0, -2)) : Number(v.slice(0, -1)) * 1000;

describe('the motion inventory', () => {
  it.each(ENTRIES)('%s: a duration taken from a token equals the token', (_, m) => {
    const t = m.token;
    if (t?.duration) expect(m.duration_ms).toBe(ms(tokens.get(t.duration)!));
    if (t?.easing) expect(m.easing).toBe(tokens.get(t.easing));
  });

  it('names only tokens that exist', () => {
    for (const [, m] of ENTRIES) {
      const t = m.token;
      for (const name of [t?.duration, t?.easing].filter(Boolean)) {
        expect(tokens.has(name!), name).toBe(true);
      }
    }
  });

  it('has nothing that lasts longer than the slowest token, so nothing runs on and on', () => {
    const longest = Math.max(
      ...[...tokens.entries()].filter(([k]) => k.startsWith('--v2-motion-')).map(([, v]) => ms(v)),
    );
    for (const m of Object.values(MOTION)) expect(m.duration_ms).toBeLessThanOrEqual(longest);
  });
});
