/**
 * When the v2 previews answer. Off Vercel in development: always. On a production build off Vercel
 * (`next build && next start` in CI): only with V2_PREVIEW_ON_NEXT_START=1. On Vercel: never. A
 * Vercel deployment is told apart by VERCEL or VERCEL_ENV being set at all, to any value, whatever
 * else is set (CC-24 brief, scope 3).
 */
import { describe, expect, it } from 'vitest';
import { previewAllowed } from '../../app/(v2-preview)/v2-preview/_preview/guard';

type Env = Record<string, string | undefined>;

const MATRIX: [string, Env, boolean][] = [
  ['development', { NODE_ENV: 'development' }, true],
  ['the test runner', { NODE_ENV: 'test' }, true],
  ['a production build', { NODE_ENV: 'production' }, false],
  [
    'a production build with the flag',
    { NODE_ENV: 'production', V2_PREVIEW_ON_NEXT_START: '1' },
    true,
  ],
  [
    'the flag spelled otherwise',
    { NODE_ENV: 'production', V2_PREVIEW_ON_NEXT_START: 'true' },
    false,
  ],
  ['the flag empty', { NODE_ENV: 'production', V2_PREVIEW_ON_NEXT_START: '' }, false],
  ['the flag in development', { NODE_ENV: 'development', V2_PREVIEW_ON_NEXT_START: '1' }, true],
];

/** Every way the brief says Vercel can show itself: each value of VERCEL_ENV, and VERCEL alone. */
const VERCEL: Env[] = [
  ...['production', 'preview', 'development', '', 'anything'].map((v) => ({ VERCEL_ENV: v })),
  { VERCEL: '1' },
  { VERCEL: '' },
];

describe('previewAllowed', () => {
  it.each(MATRIX)('off Vercel, %s: %s', (_name, env, allowed) => {
    expect(previewAllowed(env)).toBe(allowed);
  });

  // Each Vercel marker, on top of each environment above, including the ones that allow previews.
  const crossed = VERCEL.flatMap((v) =>
    MATRIX.map(([name, env]) => [JSON.stringify(v), name, { ...env, ...v }] as const),
  );
  it.each(crossed)('on Vercel (%s), %s: never', (_v, _name, env) => {
    expect(previewAllowed(env)).toBe(false);
  });

  it('reads the process environment when given none', () => {
    expect(previewAllowed()).toBe(previewAllowed(process.env));
  });
});
