import { describe, it, expect } from 'vitest';
import { findingMeta } from './finding-meta';

const KNOWN = [
  'orphan',
  'near_orphan',
  'deep_page',
  'unreachable_page',
  'over_optimized_anchor',
  'generic_anchor_overuse',
  'under_linked_important',
  'incomplete_crawl',
  'js_rendered',
] as const;

describe('finding-meta — comprehension content', () => {
  it('gives every known category a label + what + why', () => {
    for (const c of KNOWN) {
      const m = findingMeta(c);
      expect(m.label.length, c).toBeGreaterThan(0);
      expect(m.what.length, c).toBeGreaterThan(0);
      expect(m.why.length, c).toBeGreaterThan(0);
    }
  });

  it('the js_rendered "why" reframes the static read as the AI-crawler edge (names ChatGPT + Claude)', () => {
    const why = findingMeta('js_rendered').why;
    expect(why.toLowerCase()).toContain('ai crawler');
    expect(why).toContain('ChatGPT');
    expect(why).toContain('Claude');
  });

  it('tolerates an unknown/deprecated category without crashing (U13)', () => {
    const m = findingMeta('some_future_category');
    expect(m.label).toBe('some_future_category');
    expect(m.what.length).toBeGreaterThan(0);
    expect(m.why.length).toBeGreaterThan(0);
  });
});
