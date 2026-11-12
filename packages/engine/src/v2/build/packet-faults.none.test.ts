import { describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../fixtures/v2/build/recorded.js';
import { buildCheck } from './build.js';

describe('the recorded check, whose builders do not throw', () => {
  it('counts no packet fault in its grading summary', () => {
    const grading = buildCheck(recordedBuild()).summaries.find((s) => s.phase === 'grading')!;
    expect(grading.packets_not_written).toBe(0);
  });
});
