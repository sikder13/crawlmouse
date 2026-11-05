import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SPEC_06B_PATH, buildDataFoundationsSpec } from './helpers/data-foundations-spec';

describe('docs/specs/v2/06b-data-foundations.md', () => {
  it('is what the generator writes', async () => {
    expect(readFileSync(SPEC_06B_PATH, 'utf8')).toBe(await buildDataFoundationsSpec());
  }, 120_000);
});
