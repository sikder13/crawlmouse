import type { Change, Fix } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { fixWithHistory } from '../../../fixtures/v2/diff/builders.js';
import { BAD_AI_READABILITY_POINTS, BAD_TECHNICAL_SEO_POINTS, severityOf } from './severity.js';

const withEffect = (technical_seo: number, ai_readability: number | null): Fix => {
  const { fix } = fixWithHistory(1, 'open');
  return {
    ...fix,
    effect: {
      technical_seo,
      ai_readability,
      ai_readability_pending_on: ai_readability === null ? ['0000000000000001'] : [],
      estimate: true,
    },
  };
};
const change = (kind: Change['kind']) => ({ kind }) as Pick<Change, 'kind'>;

describe('severityOf (ARCH-2 §4.5)', () => {
  it('pins the thresholds ARCH-2 states', () => {
    expect(BAD_AI_READABILITY_POINTS).toBe(10);
    expect(BAD_TECHNICAL_SEO_POINTS).toBe(4);
  });

  it('calls an opened fix bad at 10 AI readability points, and warn just under', () => {
    expect(severityOf(change('opened'), withEffect(0, 10))).toBe('bad');
    expect(severityOf(change('opened'), withEffect(0, 9.99))).toBe('warn');
  });

  it('calls an opened fix bad at 4 technical SEO points, and warn just under', () => {
    expect(severityOf(change('opened'), withEffect(4, 0))).toBe('bad');
    expect(severityOf(change('opened'), withEffect(3.99, 0))).toBe('warn');
  });

  it('reads a pending AI readability effect as not reaching the threshold', () => {
    expect(severityOf(change('opened'), withEffect(0, null))).toBe('warn');
  });

  it('calls an opened change with no fix warn', () => {
    expect(severityOf(change('opened'), null)).toBe('warn');
  });

  it('calls a resolved change info, however large its fix', () => {
    expect(severityOf(change('resolved'), withEffect(50, 50))).toBe('info');
    expect(severityOf(change('resolved'), null)).toBe('info');
  });

  it('gives no severity to a changed or baseline row, which ARCH-2 does not grade', () => {
    expect(severityOf(change('changed'), withEffect(50, 50))).toBeNull();
    expect(severityOf(change('baseline'), withEffect(50, 50))).toBeNull();
  });
});
