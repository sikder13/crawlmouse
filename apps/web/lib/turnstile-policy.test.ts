import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isProductionDeployment, turnstileEnforced } from './turnstile-policy';

// The rule under test: VERCEL_ENV decides when it is set; NODE_ENV is consulted only when VERCEL_ENV is
// unset (an off-Vercel `next start`). A Vercel preview runs with NODE_ENV=production, so an "either is
// production" rule would wrongly treat previews as production — the vector below where the two differ.
describe('isProductionDeployment', () => {
  const cases: Array<[Record<string, string | undefined>, boolean]> = [
    [{ VERCEL_ENV: 'production', NODE_ENV: 'production' }, true],
    [{ VERCEL_ENV: 'production' }, true],
    [{ VERCEL_ENV: 'preview', NODE_ENV: 'production' }, false],
    [{ VERCEL_ENV: 'development', NODE_ENV: 'production' }, false],
    [{ NODE_ENV: 'production' }, true],
    [{ VERCEL_ENV: '', NODE_ENV: 'production' }, true],
    [{ NODE_ENV: 'development' }, false],
    [{ NODE_ENV: 'test' }, false],
    [{}, false],
  ];

  for (const [env, expected] of cases) {
    it(`${JSON.stringify(env)} -> ${expected}`, () => {
      expect(isProductionDeployment(env)).toBe(expected);
    });
  }

  it('preview with NODE_ENV=production is NOT production (the vector where VERCEL_ENV-first and OR-rules differ)', () => {
    const env = { VERCEL_ENV: 'preview', NODE_ENV: 'production' };
    const orRule = env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production';
    expect(orRule).toBe(true);
    expect(isProductionDeployment(env)).toBe(false);
  });

  it('property: any non-empty VERCEL_ENV other than "production" is never production, whatever NODE_ENV says', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s !== 'production'),
        fc.option(fc.string(), { nil: undefined }),
        (vercelEnv, nodeEnv) =>
          isProductionDeployment({ VERCEL_ENV: vercelEnv, NODE_ENV: nodeEnv }) === false,
      ),
    );
  });

  it('property: with VERCEL_ENV unset, the answer is exactly NODE_ENV === "production"', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string(), { nil: undefined }),
        (nodeEnv) => isProductionDeployment({ NODE_ENV: nodeEnv }) === (nodeEnv === 'production'),
      ),
    );
  });
});

describe('turnstileEnforced', () => {
  it('is enforced whenever a secret is configured, in any environment', () => {
    for (const env of [
      { NODE_ENV: 'development' },
      { VERCEL_ENV: 'preview', NODE_ENV: 'production' },
      {},
    ]) {
      expect(turnstileEnforced({ ...env, TURNSTILE_SECRET_KEY: 'configured' })).toBe(true);
    }
  });

  it('is enforced in production even with NO secret (so a missing secret fails closed instead of opening)', () => {
    expect(turnstileEnforced({ VERCEL_ENV: 'production' })).toBe(true);
    expect(turnstileEnforced({ NODE_ENV: 'production' })).toBe(true);
    expect(turnstileEnforced({ VERCEL_ENV: 'production', TURNSTILE_SECRET_KEY: '' })).toBe(true);
  });

  it('is NOT enforced without a secret on preview or in development (the permissive path stays)', () => {
    expect(turnstileEnforced({ VERCEL_ENV: 'preview', NODE_ENV: 'production' })).toBe(false);
    expect(turnstileEnforced({ NODE_ENV: 'development' })).toBe(false);
    expect(turnstileEnforced({ NODE_ENV: 'test' })).toBe(false);
  });
});
