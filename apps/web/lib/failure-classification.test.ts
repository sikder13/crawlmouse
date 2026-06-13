import { describe, it, expect } from 'vitest';
import { classifyFailure, FAILURE_COPY, type FailureCategory } from './failure-classification';

describe('classifyFailure', () => {
  it('classifies the homepage / per-page / crawl-budget timeout strings as timeout', () => {
    expect(classifyFailure('Request timed out after 15000ms: https://example.com/')).toBe('timeout');
    expect(classifyFailure('Request timed out after 10000ms: https://x.io')).toBe('timeout');
    expect(classifyFailure('connect ETIMEDOUT 93.184.216.34:443')).toBe('timeout');
    // The crawl wall-clock budget (Issue 2b, crawler.ts:runWithWallClock) emits this EXACT message;
    // lock the cross-module coupling so a future reword can't silently downgrade it to 'internal'.
    expect(classifyFailure('Crawl timed out after 240000ms (wall-clock budget)')).toBe('timeout');
  });

  it('classifies DNS resolution failures as dns', () => {
    // The string the engine ACTUALLY emits for a non-resolving domain: the SSRF guard's
    // defaultResolver swallows the raw Node DNS error and validateUrlOrThrow / createSafeLookup
    // throw this wrapped message (packages/engine/src/ssrf-guard.ts:164,204). validateUrlOrThrow
    // runs first in runAudit, so this is the homepage's most common reachability failure.
    expect(classifyFailure('DNS resolution failed for nope.invalid')).toBe('dns');
    expect(classifyFailure('DNS resolution failed for typo.example')).toBe('dns');
    // Defensive: raw Node DNS errors too, for any non-pinned path.
    expect(classifyFailure('getaddrinfo ENOTFOUND nope.invalid')).toBe('dns');
    expect(classifyFailure('getaddrinfo EAI_AGAIN flaky.example')).toBe('dns');
  });

  it('classifies active refusals / 403 / bot challenges as blocked', () => {
    expect(classifyFailure('read ECONNRESET')).toBe('blocked');
    expect(classifyFailure('socket hang up')).toBe('blocked');
    expect(classifyFailure('connect ECONNREFUSED 1.2.3.4:443')).toBe('blocked');
    expect(classifyFailure('Request failed with status code 403 Forbidden')).toBe('blocked');
    expect(classifyFailure('Just a moment... cf challenge')).toBe('blocked');
  });

  it('falls back to internal for unknown / empty / null reasons', () => {
    expect(classifyFailure('Response body exceeded 10485760 bytes')).toBe('internal');
    expect(classifyFailure('Too many redirects (> 5) starting from https://x')).toBe('internal');
    expect(classifyFailure('some unexpected database error')).toBe('internal');
    // A bare digit-run that merely embeds 403 (e.g. a reference id) must NOT read as a 403 block.
    expect(classifyFailure('internal error reference 1403007')).toBe('internal');
    expect(classifyFailure('')).toBe('internal');
    expect(classifyFailure(null)).toBe('internal');
    expect(classifyFailure(undefined)).toBe('internal');
  });

  it('prioritizes timeout over an incidental 403 substring elsewhere in the message', () => {
    expect(classifyFailure('Request timed out after 15000ms: https://x.com/error/403')).toBe('timeout');
  });
});

describe('FAILURE_COPY', () => {
  it('has distinct, non-empty copy for every category', () => {
    const cats: FailureCategory[] = ['timeout', 'dns', 'blocked', 'internal'];
    const titles = new Set<string>();
    for (const c of cats) {
      expect(FAILURE_COPY[c].title.length).toBeGreaterThan(0);
      expect(FAILURE_COPY[c].body.length).toBeGreaterThan(0);
      titles.add(FAILURE_COPY[c].title);
    }
    expect(titles.size).toBe(cats.length); // distinct copy per category, no accidental duplication
  });
});
