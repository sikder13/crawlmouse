import { describe, expect, it } from 'vitest';
import { CAP_ENV, capsFromEnv } from './budget.js';

describe('the render caps', () => {
  it('are read from the environment in whole seconds', () => {
    expect(
      capsFromEnv({
        RENDER_MAX_BROWSER_SECONDS_PER_CHECK: '200',
        RENDER_MAX_BROWSER_SECONDS_PER_DAY: ' 36000 ',
      }),
    ).toEqual({ perCheckMs: 200_000, perDayMs: 36_000_000 });
  });

  it('name the two variables the runbook names', () => {
    expect(CAP_ENV).toEqual({
      perCheck: 'RENDER_MAX_BROWSER_SECONDS_PER_CHECK',
      perDay: 'RENDER_MAX_BROWSER_SECONDS_PER_DAY',
    });
  });

  it.each([undefined, '', ' ', 'abc', '-5', '1.5', '1e3', '0x10', 'Infinity'])(
    'are zero, so nothing renders, when a value is %j: fail closed',
    (value) => {
      expect(
        capsFromEnv({
          RENDER_MAX_BROWSER_SECONDS_PER_CHECK: value,
          RENDER_MAX_BROWSER_SECONDS_PER_DAY: value,
        }),
      ).toEqual({ perCheckMs: 0, perDayMs: 0 });
    },
  );

  it('are read each on its own', () => {
    expect(capsFromEnv({ RENDER_MAX_BROWSER_SECONDS_PER_CHECK: '100' })).toEqual({
      perCheckMs: 100_000,
      perDayMs: 0,
    });
  });
});
