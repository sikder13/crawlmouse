import { describe, expect, it } from 'vitest';
import { grid, TESTABLE } from '../../../fixtures/v2/access/builders.js';
import { CRAWLER_REGISTRY_V2 } from '../crawler-registry.js';
import { detectAccess } from './index.js';

/** Every crawler served on every page of four templates, robots.txt allowing all of them. */
const CLEAN = grid({ pages: ['/', '/blog/a', '/blog/b', '/products/x', '/about/us'] });

describe('a clean site', () => {
  const out = detectAccess(CLEAN);

  it('nothing fires, and every fingerprint is decided', () => {
    expect(out.detections.filter((d) => d.state !== 'not_detected')).toEqual([]);
    expect(out.detections.map((d) => d.key)).toEqual(
      [
        ...TESTABLE.map((t) => `edge:${t.toLowerCase()}`),
        ...CRAWLER_REGISTRY_V2.map((e) => `robots:${e.token.toLowerCase()}`),
      ].sort(),
    );
  });

  it('every crawler is allowed with full confidence, and the access score is given', () => {
    expect(out.crawlers.map((c) => [c.ua, c.verdict, c.confidence, c.cause])).toEqual(
      CRAWLER_REGISTRY_V2.map((e) => [e.token, 'allowed', 'confirmed', null]),
    );
    expect(out.access_withheld).toBe(false);
    expect(out.scored_measured).toBe(4);
  });

  it('is sorted by type, then key, with a fingerprint of 16 hex characters each', () => {
    const order = out.detections.map((d) => `${d.type}\u0000${d.key}`);
    expect(order).toEqual([...order].sort());
    for (const d of out.detections) expect(d.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
});
