/**
 * The grade-change guard: the grades are a published number, so the code that computes them cannot
 * change without the record of what it computes. expected.json holds a digest of every file the grades
 * are computed from and the grades and effects of the example sites; this test fails when either no
 * longer matches. To change the grades, change GRADE_VERSION and run fixtures/v2/grade/write-expected.ts,
 * which refuses changed results under an unchanged version.
 */
import { describe, expect, it } from 'vitest';
import { gradeSources, guardCases, sourceDigest } from '../../../fixtures/v2/grade/guard.js';
import expected from './expected.json' with { type: 'json' };
import { GRADE_VERSION } from './weights.js';

describe('the grade-change guard', () => {
  it('the grade code is the code expected.json was written from', () => {
    expect(gradeSources()).toContain('v2/grade/access.ts');
    expect(gradeSources()).toContain('grade.ts');
    expect(sourceDigest(), 'grade code changed without expected.json').toBe(expected.source_digest);
  });

  it('it is recorded under the current grade version', () => {
    expect(expected.grade_version).toBe(GRADE_VERSION);
  });

  it('the example sites grade as recorded', () => {
    expect(JSON.parse(JSON.stringify(guardCases()))).toEqual(expected.cases);
  });
});
