import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { WEB_ROOT, parseTokens } from '../../__tests__/v2/_lib/tokens-css';
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

describe('the CSS transitions on the audit-flow screens', () => {
  const dir = join(WEB_ROOT, 'components', 'v2', 'screens');
  const sheets = readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.css'))
    .map((f) => ({
      file: f,
      css: readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
    }));
  const declared = sheets.flatMap(({ file, css }) =>
    [...css.matchAll(/([^{}]+)\{[^{}]*?transition(?:-property)?:\s*([^;]+);/g)].map((m) => ({
      file,
      rule: m[1]!.trim(),
      value: m[2]!.trim(),
    })),
  );
  const transitionOf = (m: MotionEntry, property: string) =>
    `${property} ${m.duration_ms}ms ${m.easing}`;

  it('finds the transitions it pins, so a rename cannot make it pass by finding none', () => {
    expect(declared.length).toBeGreaterThan(2);
  });

  it('gives the progress bar and the verdict panel the timing their entries say', () => {
    const value = (rule: string) => declared.find((d) => d.rule === rule)?.value;
    expect(value('.fill')).toBe(transitionOf(MOTION.progressBar, 'transform'));
    expect(value('.verdictsOver')).toBe(transitionOf(MOTION.verdictPanel, 'opacity'));
  });

  it('has no other transition, and none on anything but transform or opacity', () => {
    const pinned = new Set([
      transitionOf(MOTION.progressBar, 'transform'),
      transitionOf(MOTION.verdictPanel, 'opacity'),
      'none',
    ]);
    for (const d of declared)
      expect(pinned.has(d.value), `${d.file} ${d.rule}: ${d.value}`).toBe(true);
  });
});
