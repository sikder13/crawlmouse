import { describe, it, expect } from 'vitest';
import {
  MIN_MAIN_TEXT_CHARS,
  PARTIAL_FLOOR,
  EXCERPT_MAX_BYTES,
  AI_BAND_READY_MIN,
  AI_BAND_PARTIAL_MIN,
  AI_COMPONENT_WEIGHTS,
  PAGE_CLASS_SUBSCORE,
  LEGIBILITY_PERPAGE_WEIGHT,
  LEGIBILITY_ENTITY_WEIGHT,
  AI_STRUCTURAL_STRIP,
  CMP_STRIP_SELECTORS,
  AI_CSR_MOUNT_SELECTORS,
  AI_FRAMEWORK_MOUNT_SELECTORS,
  AI_BOT_REGISTRY,
  WAF_HEADER_ALLOWLIST,
} from './constants.js';

// Amendment v1.1 §7 pins these DEFAULTS as owner-approved. Lock them as LITERALS so a silent drift
// (which every symbolic test would follow) fails here. If a value must change, it changes with sign-off.
describe('ai-readiness constants — pinned defaults (Amendment v1.1 §7)', () => {
  it('locks the classifier + excerpt thresholds', () => {
    expect(MIN_MAIN_TEXT_CHARS).toBe(200);
    expect(PARTIAL_FLOOR).toBe(50);
    expect(EXCERPT_MAX_BYTES).toBe(2000);
  });

  it('locks the score bands and component weights (weights sum to 100)', () => {
    expect(AI_BAND_READY_MIN).toBe(80);
    expect(AI_BAND_PARTIAL_MIN).toBe(50);
    expect(AI_COMPONENT_WEIGHTS).toEqual({ access: 25, contentWithoutJs: 40, machineLegibility: 20, retrievalPath: 15 });
    const sum = Object.values(AI_COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('locks the per-class subscores and legibility blend', () => {
    expect(PAGE_CLASS_SUBSCORE).toEqual({ readable: 1.0, thin: 1.0, partial: 0.5, js_blind: 0 });
    expect(LEGIBILITY_PERPAGE_WEIGHT + LEGIBILITY_ENTITY_WEIGHT).toBeCloseTo(1.0, 10);
    expect(LEGIBILITY_PERPAGE_WEIGHT).toBe(0.85);
  });

  it('the boilerplate selector sets contain NO wildcards (A3 high-precision rule)', () => {
    for (const sel of [AI_STRUCTURAL_STRIP, CMP_STRIP_SELECTORS]) {
      expect(sel).not.toContain('*');
      expect(sel).not.toMatch(/\[[^\]]*[*^$~][^\]]*=/); // no [class*=]/[class^=]/[class$=]/[class~=] substring matchers
    }
  });

  it('the framework mount set is a subset of the CSR mount set and excludes the generic ids', () => {
    for (const m of AI_FRAMEWORK_MOUNT_SELECTORS) expect(AI_CSR_MOUNT_SELECTORS).toContain(m);
    expect(AI_FRAMEWORK_MOUNT_SELECTORS).not.toContain('#root');
    expect(AI_FRAMEWORK_MOUNT_SELECTORS).not.toContain('#app');
    expect(AI_CSR_MOUNT_SELECTORS).toContain('#__nuxt'); // Amendment §5 superset
  });

  it('locks the bot registry tokens + classes (§3)', () => {
    const byClass = (c: string) => AI_BOT_REGISTRY.filter((b) => b.botClass === c).map((b) => b.token);
    expect(byClass('retrieval')).toEqual([
      'OAI-SearchBot',
      'ChatGPT-User',
      'Claude-SearchBot',
      'Claude-User',
      'PerplexityBot',
      'Perplexity-User',
    ]);
    expect(byClass('training')).toEqual(['GPTBot', 'ClaudeBot', 'CCBot', 'Meta-ExternalAgent', 'Bytespider', 'Amazonbot']);
    expect(byClass('opt_out_token')).toEqual(['Google-Extended', 'Applebot-Extended']);
  });

  it('the WAF allowlist uses EXACT header names only — no prefix/wildcard patterns (Amendment §6)', () => {
    for (const rule of WAF_HEADER_ALLOWLIST) {
      expect(rule.header).toBe(rule.header.toLowerCase());
      expect(rule.header).not.toContain('*');
      expect(rule.header).not.toMatch(/[*?]/);
    }
    expect(WAF_HEADER_ALLOWLIST.map((r) => r.header)).toContain('cf-ray');
  });
});
