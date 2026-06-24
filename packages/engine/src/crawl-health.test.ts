import { describe, it, expect } from 'vitest';
import { classifyFetchOutcome, classifyConfidence, computeCrawlHealth, formatCrawlHealth } from './crawl-health.js';

describe('classifyFetchOutcome (§1 taxonomy)', () => {
  it('maps 200 to ok', () => {
    expect(classifyFetchOutcome(200)).toBe('ok');
  });
  it('maps 403/429/503/0 (throttle/block/timeout/reset) to blocked', () => {
    for (const s of [0, 403, 429, 503]) expect(classifyFetchOutcome(s), `status ${s}`).toBe('blocked');
  });
  it('maps other 4xx/5xx to dead', () => {
    for (const s of [404, 410, 500, 502]) expect(classifyFetchOutcome(s), `status ${s}`).toBe('dead');
  });
});

describe('classifyConfidence (§6 thresholds)', () => {
  it('is high only when block_rate ≤ 0.05 AND coverage ≥ 0.9', () => {
    expect(classifyConfidence(0, 1)).toBe('high');
    expect(classifyConfidence(0.05, 0.9)).toBe('high'); // exact thresholds sit in the better bucket
  });
  it('is medium when block_rate > 0.05 or coverage < 0.9 (but not low)', () => {
    expect(classifyConfidence(0.06, 1)).toBe('medium');
    expect(classifyConfidence(0, 0.89)).toBe('medium');
    expect(classifyConfidence(0.15, 0.7)).toBe('medium'); // exact low thresholds → still medium
  });
  it('is low when block_rate > 0.15 or coverage < 0.7', () => {
    expect(classifyConfidence(0.16, 1)).toBe('low');
    expect(classifyConfidence(0, 0.69)).toBe('low');
    expect(classifyConfidence(0.4, 0.33)).toBe('low');
  });
});

describe('computeCrawlHealth', () => {
  it('counts outcomes and derives coverage/block_rate/partial/confidence', () => {
    // 2 ok, 2 blocked (403, 0), 1 dead (404); 6 discovered (one URL seen but not fetched → partial).
    const pages = [{ statusCode: 200 }, { statusCode: 200 }, { statusCode: 403 }, { statusCode: 0 }, { statusCode: 404 }];
    const h = computeCrawlHealth(pages, 6);
    expect(h.attempted).toBe(5);
    expect(h.fetchedOk).toBe(2);
    expect(h.blocked).toBe(2);
    expect(h.dead).toBe(1);
    expect(h.discovered).toBe(6);
    expect(h.coveragePct).toBeCloseTo(2 / 6, 5); // fetchedOk / discovered
    expect(h.blockRate).toBeCloseTo(2 / 5, 5); // blocked / attempted
    expect(h.partial).toBe(true); // discovered (6) > attempted (5)
    expect(h.confidence).toBe('low'); // block_rate 0.4 > 0.15
  });

  it('reports high confidence and not partial on a clean, fully-fetched crawl', () => {
    const pages = Array.from({ length: 10 }, () => ({ statusCode: 200 }));
    const h = computeCrawlHealth(pages, 10);
    expect(h.fetchedOk).toBe(10);
    expect(h.coveragePct).toBe(1);
    expect(h.blockRate).toBe(0);
    expect(h.partial).toBe(false);
    expect(h.confidence).toBe('high');
  });

  it('never lets discovered fall below fetchedOk, and is safe on an empty crawl', () => {
    expect(computeCrawlHealth([{ statusCode: 200 }, { statusCode: 200 }], 1).discovered).toBe(2);
    const empty = computeCrawlHealth([], 0);
    expect(empty).toMatchObject({ attempted: 0, fetchedOk: 0, coveragePct: 0, blockRate: 0, partial: false });
  });
});

describe('formatCrawlHealth (§6 CLI/diagnostic summary)', () => {
  it('renders confidence, coverage, block-rate and raw counts as a deterministic block', () => {
    const out = formatCrawlHealth({
      discovered: 400, fetchedOk: 380, blocked: 12, dead: 8, attempted: 400,
      coveragePct: 0.95, blockRate: 0.03, partial: false, confidence: 'high',
    });
    expect(out).toContain('Confidence: high');
    expect(out).toContain('95.0%'); // coveragePct → fixed 1-decimal, locale-independent
    expect(out).toContain('380/400'); // fetchedOk / discovered
    expect(out).toContain('3.0%'); // blockRate
    expect(out).toContain('12 blocked, 8 dead'); // raw outcome counts
    expect(out).toContain('400 attempted');
    expect(out).toMatch(/Partial:\s+no/);
  });

  it('marks a budget/cap-truncated, low-confidence crawl as partial', () => {
    const out = formatCrawlHealth({
      discovered: 500, fetchedOk: 300, blocked: 50, dead: 10, attempted: 360,
      coveragePct: 0.6, blockRate: 0.2, partial: true, confidence: 'low',
    });
    expect(out).toContain('Confidence: low');
    expect(out).toContain('60.0%');
    expect(out).toContain('20.0%');
    expect(out).toMatch(/Partial:\s+yes/);
  });

  it('is pure and stable: exactly four lines, no I/O, clean 100%/0% formatting', () => {
    const out = formatCrawlHealth({
      discovered: 10, fetchedOk: 10, blocked: 0, dead: 0, attempted: 10,
      coveragePct: 1, blockRate: 0, partial: false, confidence: 'high',
    });
    expect(out.split('\n')).toHaveLength(4);
    expect(out).toContain('100.0%');
    expect(out).toContain('0.0%');
  });
});
