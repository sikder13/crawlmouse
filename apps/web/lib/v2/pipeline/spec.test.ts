import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';
import { SPEC_20B_PATH, buildSpec20b } from './spec';

const path = fileURLToPath(new URL(`../../../../../${SPEC_20B_PATH}`, import.meta.url));

describe('docs/specs/v2/20b-pipeline.md', () => {
  it('is exactly what write-spec.ts writes from the code', async () => {
    const options = { ...(await resolveConfig(path)), filepath: path };
    expect(readFileSync(path, 'utf8')).toBe(await format(`${buildSpec20b()}\n`, options));
  });
});
