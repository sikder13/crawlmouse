import { describe, expect, it } from 'vitest';
import { MalformedTrialDecisionError, parseTrialDecision } from './trial-decision';

describe("parseTrialDecision: start_trial_with_ledger's answer, read strictly", () => {
  it('reads each of the three outcomes', () => {
    expect(parseTrialDecision({ outcome: 'started', hits: [] })).toEqual({
      outcome: 'started',
      hits: [],
    });
    expect(parseTrialDecision({ outcome: 'refused', hits: ['email', 'device', 'ip24'] })).toEqual({
      outcome: 'refused',
      hits: ['email', 'device', 'ip24'],
    });
    expect(parseTrialDecision({ outcome: 'not_eligible', hits: [] })).toEqual({
      outcome: 'not_eligible',
      hits: [],
    });
  });

  it.each([
    ['null', null],
    ['a string', 'started'],
    ['an array', ['started']],
    ['an unknown outcome', { outcome: 'busy', hits: [] }],
    ['no hits', { outcome: 'started' }],
    ['hits that are not an array', { outcome: 'refused', hits: 'email' }],
    ['an unknown kind among the hits', { outcome: 'refused', hits: ['hostname'] }],
    ['a refusal with no kind', { outcome: 'refused', hits: [] }],
    ['a start that names a kind', { outcome: 'started', hits: ['email'] }],
    ['an extra key', { outcome: 'started', hits: [], version: 2 }],
  ])('refuses %s', (_name, raw) => {
    expect(() => parseTrialDecision(raw)).toThrow(MalformedTrialDecisionError);
  });
});
