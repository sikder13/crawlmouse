import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SPEC_06_PATH, buildCheckTablesSpec } from './helpers/check-tables-spec';

describe('docs/specs/v2/06-check-tables.md', () => {
  it('is what the generator writes', async () => {
    expect(readFileSync(SPEC_06_PATH, 'utf8')).toBe(await buildCheckTablesSpec());
  }, 120_000);
});
