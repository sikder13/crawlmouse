import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SPEC_06C_PATH, buildTrialFunctionSpec } from './helpers/trial-function-spec';

describe('docs/specs/v2/06c-trial-function.md', () => {
  it('is what the generator writes', async () => {
    expect(readFileSync(SPEC_06C_PATH, 'utf8')).toBe(await buildTrialFunctionSpec());
  }, 120_000);
});
