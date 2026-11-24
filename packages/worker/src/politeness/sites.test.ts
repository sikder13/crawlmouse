import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { systemClock } from '../clock.js';
import { MAX_BACKOFF_GAP_MS, STOP_AFTER_429S, STOP_COOLDOWN_MS, Sites } from './sites.js';

beforeEach(() => vi.useFakeTimers({ now: 5_000_000 }));
afterEach(() => vi.useRealTimers());

describe('Sites: stop rules', () => {
  it('stops a site on its STOP_AFTER_429S-th 429 in a row, not the one before', () => {
    const sites = new Sites(systemClock);
    for (let i = 1; i < STOP_AFTER_429S; i++) sites.record429('example.com');
    expect(sites.stopOf('example.com')).toBeNull();
    sites.record429('example.com');
    expect(sites.stopOf('example.com')).toMatchObject({ reason: 'three_429_responses' });
  });

  it('ends the run of 429s on any other answer', () => {
    const sites = new Sites(systemClock);
    for (let i = 1; i < STOP_AFTER_429S; i++) sites.record429('example.com');
    sites.recordAnswer('example.com');
    for (let i = 1; i < STOP_AFTER_429S; i++) sites.record429('example.com');
    expect(sites.stopOf('example.com')).toBeNull();
  });

  it('slows the site on each 429, to at most MAX_BACKOFF_GAP_MS, and keeps it slowed', () => {
    const sites = new Sites(systemClock);
    const gaps = [];
    for (let i = 1; i < STOP_AFTER_429S; i++) {
      sites.record429('example.com');
      gaps.push(sites.limiter('example.com').gapMs());
    }
    expect(gaps).toEqual([1_000, 2_000, 4_000, 8_000, 8_000].slice(0, STOP_AFTER_429S - 1));
    expect(Math.max(...gaps)).toBe(MAX_BACKOFF_GAP_MS);
    sites.recordAnswer('example.com');
    expect(sites.limiter('example.com').gapMs()).toBe(MAX_BACKOFF_GAP_MS);
  });

  it('stops on four consecutive challenged pages, and a served page resets the run', () => {
    const sites = new Sites(systemClock);
    for (const challenged of [true, true, true, false, true, true, true]) {
      sites.recordPage('example.com', challenged);
    }
    expect(sites.stopOf('example.com')).toBeNull();
    sites.recordPage('example.com', true);
    expect(sites.stopOf('example.com')).toMatchObject({
      reason: 'four_consecutive_challenged_pages',
    });
  });

  it('keeps sites apart: a stop on one does not touch another', () => {
    const sites = new Sites(systemClock);
    for (let i = 0; i < STOP_AFTER_429S; i++) sites.record429('a.example');
    expect(sites.stopOf('b.example')).toBeNull();
  });

  it('lifts a stop after the cooldown and starts the counts again', () => {
    const sites = new Sites(systemClock);
    for (let i = 0; i < STOP_AFTER_429S; i++) sites.record429('example.com');
    vi.advanceTimersByTime(STOP_COOLDOWN_MS - 1);
    expect(sites.stopOf('example.com')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(sites.stopOf('example.com')).toBeNull();
    sites.record429('example.com');
    expect(sites.stopOf('example.com')).toBeNull();
  });
});

describe('Sites: memory', () => {
  it('forgets an idle site, but never a stopped one', () => {
    const sites = new Sites(systemClock);
    sites.limiter('idle.example');
    for (let i = 0; i < STOP_AFTER_429S; i++) sites.record429('stopped.example');
    vi.advanceTimersByTime(61_000);
    sites.sweep();
    expect(Object.keys(sites.requestsPerSite())).toEqual(['stopped.example']);
  });

  it('holds a site with a long gap until that gap has passed, so pacing survives forgetting', () => {
    const sites = new Sites(systemClock);
    sites.limiter('slow.example').raiseGapMs(90_000);
    vi.advanceTimersByTime(61_000);
    sites.sweep();
    expect(Object.keys(sites.requestsPerSite())).toEqual(['slow.example']);
    vi.advanceTimersByTime(29_000);
    sites.sweep();
    expect(Object.keys(sites.requestsPerSite())).toEqual([]);
  });
});
