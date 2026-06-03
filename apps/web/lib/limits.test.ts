import { describe, it, expect } from 'vitest';
import {
  FREE_PAGE_CAP, PRO_PAGE_CAP, FREE_CONCURRENCY, PRO_CONCURRENCY,
  IP_AUDITS_PER_DAY_ANON, IP_AUDITS_PER_DAY_USER, DOMAIN_AUDITS_PER_HOUR,
  GLOBAL_AUDITS_PER_DAY, isPassingScore, PASSING_SCORE,
  WAITLIST_PER_IP_PER_DAY,
} from './limits';

describe('cost-control levers (regression lock)', () => {
  it('page caps and concurrency hold their tuned values', () => {
    expect(FREE_PAGE_CAP).toBe(500);
    expect(PRO_PAGE_CAP).toBe(2000);
    expect(FREE_CONCURRENCY).toBe(1);
    expect(PRO_CONCURRENCY).toBe(8);
  });
  it('rate limits are ordered free < user and a global ceiling exists', () => {
    expect(IP_AUDITS_PER_DAY_ANON).toBeLessThan(IP_AUDITS_PER_DAY_USER);
    expect(DOMAIN_AUDITS_PER_HOUR).toBe(1);
    expect(GLOBAL_AUDITS_PER_DAY).toBeGreaterThan(IP_AUDITS_PER_DAY_USER);
    // Exact-value lock: the cost-model backstop (worst-case ≈ 5000 × $0.0031/day)
    // is derived from this exact ceiling, so pin it like every other lever.
    expect(GLOBAL_AUDITS_PER_DAY).toBe(5000);
  });
  it('developer-waitlist per-IP cap holds its tuned value and is a positive integer', () => {
    expect(WAITLIST_PER_IP_PER_DAY).toBe(5);
    expect(Number.isInteger(WAITLIST_PER_IP_PER_DAY)).toBe(true);
    expect(WAITLIST_PER_IP_PER_DAY).toBeGreaterThan(0);
  });
  it('passing boundary matches the engine grade boundary (>=60)', () => {
    expect(PASSING_SCORE).toBe(60);
    expect(isPassingScore(60)).toBe(true);
    expect(isPassingScore(59)).toBe(false);
    expect(isPassingScore(null)).toBe(false);
  });
});
