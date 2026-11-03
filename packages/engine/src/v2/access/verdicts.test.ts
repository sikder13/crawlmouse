import { describe, expect, it } from 'vitest';
import { robotsMostlyDisallows, servedHolds, uaBlockHolds } from './verdicts.js';

/**
 * The callers reach these only with pages to judge, so the guards below are what make each
 * function's comment true on its own: with nothing read or answered, none of them holds.
 */
describe('the shared conditions, on no pages', () => {
  it('none holds', () => {
    expect(robotsMostlyDisallows([])).toBe(false);
    expect(servedHolds([])).toBe(false);
    expect(uaBlockHolds([])).toBe(false);
  });
});
