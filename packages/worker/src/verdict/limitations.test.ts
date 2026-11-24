import { describe, expect, it } from 'vitest';
import { STOP_AFTER_429S } from '../politeness/sites.js';
import { notRequested } from './limitations.js';

describe('the sentence a site stop writes on a row', () => {
  it('says how many 429s in a row stopped the site, and claims nothing about how long we waited', () => {
    const said = notRequested({
      reason: 'site_stopped',
      site: 'example.com',
      stop: { reason: 'three_429_responses', at: 0, until: 1 },
    });
    expect(said).toBe(
      `Not requested: requests to example.com were stopped because it answered 429 ${STOP_AFTER_429S} times in a row. The user agent shown is the one that would have been sent.`,
    );
    expect(said).not.toMatch(/as it asked|each time/);
  });
});
