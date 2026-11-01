import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderStructureSpec, SPEC_URL } from './spec.js';

describe('docs/specs/v2/16-structure-detectors.md', () => {
  it('is exactly what the code renders it to', () => {
    expect(readFileSync(SPEC_URL, 'utf8')).toBe(renderStructureSpec());
  });
});
