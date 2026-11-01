import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { systemClock } from '../clock.js';
import { STOP_COOLDOWN_MS, Sites } from './sites.js';

beforeEach(() => vi.useFakeTimers({ now: 5_000_000 }));
afterEach(() => vi.useRealTimers());

describe('Sites: stop rules', () => {
  it('stops a site on its third 429, not its second', () => {
    const sites = new Sites(systemClock);
    sites.record429('example.com');
    sites.record429('example.com');
    expect(sites.stopOf('example.com')).toBeNull();
    sites.record429('example.com');
    expect(sites.stopOf('example.com')).toMatchObject({ reason: 'three_429_responses' });
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
    for (let i = 0; i < 3; i++) sites.record429('a.example');
    expect(sites.stopOf('b.example')).toBeNull();
  });

  it('lifts a stop after the cooldown and starts the counts again', () => {
    const sites = new Sites(systemClock);
    for (let i = 0; i < 3; i++) sites.record429('example.com');
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
    for (let i = 0; i < 3; i++) sites.record429('stopped.example');
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
