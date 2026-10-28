/**
 * The full contract test lives in packages/types/src/v2/contract.test.ts. This copy of its first check
 * sits next to the fixtures because the local turbo cache keys each package's tests on that package's
 * own files: an edit to a fixture alone would otherwise replay a cached pass for @crawlmouse/types.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FixtureDatasetSchema } from '@crawlmouse/types/v2';

const DIR = new URL('./', import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));

describe('v2 fixtures', () => {
  it('holds the three contract fixtures', () => {
    expect(files.sort()).toEqual(['bad-site.json', 'challenged-site.json', 'clean-site.json']);
  });

  it.each(files)('%s parses with FixtureDatasetSchema', (file) => {
    const result = FixtureDatasetSchema.safeParse(
      JSON.parse(readFileSync(new URL(file, DIR), 'utf8')),
    );
    expect(result.success, result.success ? '' : z.prettifyError(result.error)).toBe(true);
  });
});
