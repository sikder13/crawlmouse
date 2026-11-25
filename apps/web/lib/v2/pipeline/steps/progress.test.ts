import { describe, expect, it } from 'vitest';
import { phaseOf } from './progress';

describe('phaseOf', () => {
  it('names the first crawl batch homepage, later crawl batches crawl, and access crawler_tests', () => {
    expect(phaseOf({ kind: 'crawl', batch: 1, stage: null })).toBe('homepage');
    expect(phaseOf({ kind: 'crawl', batch: 2, stage: null })).toBe('crawl');
    expect(phaseOf({ kind: 'access', batch: 3, stage: 1 })).toBe('crawler_tests');
  });

  // F-260: a retry run numbers its batches from firstBatch, past the first run's.
  it('names a retry run’s first crawl batch homepage, by firstBatch', () => {
    expect(phaseOf({ kind: 'crawl', batch: 7, stage: null }, 7)).toBe('homepage');
    expect(phaseOf({ kind: 'crawl', batch: 1, stage: null }, 7)).toBe('crawl');
    expect(phaseOf({ kind: 'crawl', batch: 8, stage: null }, 7)).toBe('crawl');
  });
});
