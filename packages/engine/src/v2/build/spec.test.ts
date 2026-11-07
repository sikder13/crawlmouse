import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderBuildSpec, SPEC_URL } from './spec.js';

describe('docs/specs/v2/20a-check-builder.md', () => {
  it('is exactly what the code and the recorded fixture render it to', () => {
    expect(readFileSync(SPEC_URL, 'utf8')).toBe(renderBuildSpec());
  });
});
