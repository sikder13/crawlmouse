import { describe, it, expect } from 'vitest';
import {
  FREE_PAGE_CAP, PRO_PAGE_CAP, FREE_CONCURRENCY, PRO_CONCURRENCY,
  IP_AUDITS_PER_DAY_ANON, IP_AUDITS_PER_DAY_USER, DOMAIN_AUDITS_PER_HOUR,
  GLOBAL_AUDITS_PER_DAY, isPassingScore, PASSING_SCORE,
  WAITLIST_PER_IP_PER_DAY,
  SSE_POLL_MS, SSE_MAX_DURATION_S, SSE_SELF_CLOSE_MS,
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
  it('per-IP daily audit caps hold their exact tuned values', () => {
    // Pin the absolute values (not just the ordering) so the launch-verification
    // boundary tests (the (N+1)th-is-429 leg) track the source of truth — a retune
    // would fail here instead of silently shifting the expected boundary.
    expect(IP_AUDITS_PER_DAY_USER).toBe(5);
    expect(IP_AUDITS_PER_DAY_ANON).toBe(3);
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

  it('SSE stream self-closes with a healthy buffer before the Vercel function ceiling', () => {
    // The stream must self-terminate (with a retry hint) BEFORE Vercel kills the function at
    // maxDuration, or a stuck audit gets truncated mid-write and churns EventSource reconnects.
    // Keep at least a 30s buffer, and outlast at least one poll so a near-instant audit isn't
    // cut off early.
    expect(SSE_SELF_CLOSE_MS).toBeLessThan(SSE_MAX_DURATION_S * 1000);
    expect(SSE_MAX_DURATION_S * 1000 - SSE_SELF_CLOSE_MS).toBeGreaterThanOrEqual(30_000);
    expect(SSE_SELF_CLOSE_MS).toBeGreaterThan(SSE_POLL_MS);
  });
});
