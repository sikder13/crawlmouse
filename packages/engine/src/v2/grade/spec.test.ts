import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderGradeSpec, SPEC_URL } from './spec.js';

describe('docs/specs/v2/17-content-and-grade.md', () => {
  it('is exactly what the code renders it to', () => {
    expect(readFileSync(SPEC_URL, 'utf8')).toBe(renderGradeSpec());
  });
});
