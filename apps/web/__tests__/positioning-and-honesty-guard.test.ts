import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guard for the SPEC 03 copy/positioning pass. It pins three contracts in source so they can't
// silently regress:
//   1. AI-crawler positioning is present and names real crawlers (the one structural edge over the
//      big SEO tools): AI crawlers don't run JavaScript, so our static read is literally what they
//      see.
//   2. HARD BOUNDARY — we claim the positioning, NOT a feature: no surface may imply an
//      "AI-readiness score" (that score is a separate post-launch spec, SPEC 05).
//   3. HONESTY — the conversion surfaces sell discoverability + the grade, never rankings/traffic.
//      The gap is a claim about the GRADE, with an honest recrawl/re-rank timeline.
//
// Modeled on no-placeholders.test.ts: readFileSync is atomic, so a missing/renamed file throws
// ENOENT and the test FAILS LOUD rather than silently skipping a surface.
const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

// Conversion surfaces this pass owns — these must never promise rankings/traffic.
const HONESTY_SURFACES = [
  'app/page.tsx',
  'app/pricing/page.tsx',
  'app/login/page.tsx',
  'components/billing/PricingCards.tsx',
  'components/audit/GapPanel.tsx',
  'components/audit/ResultView.tsx',
  'components/audit/GradeReveal.tsx',
  'components/audit/FreeFixCard.tsx',
  'components/audit/CureWall.tsx',
  'components/audit/SaveAndMonitorCta.tsx',
  'components/audit/FindingsPanel.tsx',
] as const;

// The honesty surfaces plus the AI-positioning sources — none may imply a score exists.
const NO_SCORE_SURFACES = [
  ...HONESTY_SURFACES,
  'components/audit/finding-meta.ts',
  'lib/seo/faq.ts',
] as const;

// Unambiguous rankings/traffic PROMISES. Deliberately narrow (positive promises only) so honest,
// negated copy — "not a traffic forecast", "we don't guarantee any ranking outcome" — never trips.
const PROMISE_PATTERNS: readonly RegExp[] = [
  /rank(s|ing)?\s+higher/i,
  /\boutrank\b/i,
  /more\s+traffic/i,
  /drive\s+traffic/i,
  /boost\s+(your\s+)?(seo|traffic|ranking)/i,
  /increase\s+(your\s+)?traffic/i,
  /first\s+page\s+of\s+google/i,
  /\bovernight\b/i,
  /guaranteed?\s+(ranking|traffic|results)/i,
];

// "AI-readiness score/grade" in any spacing/hyphenation — the SPEC 05 feature we must NOT imply.
const SCORE_PATTERNS: readonly RegExp[] = [
  /ai[-\s]?readiness\s+(score|grade|rating)/i,
];

describe('SPEC 03 copy — AI-crawler positioning is present and honest', () => {
  it('the homepage hero carries the AI-crawler positioning, naming ChatGPT and Claude', () => {
    const src = read('app/page.tsx');
    expect(/ai crawlers?/i.test(src), 'homepage must mention AI crawlers').toBe(true);
    expect(src).toContain('ChatGPT');
    expect(src).toContain('Claude');
  });

  it('the homepage FAQ answers whether AI crawlers can see the site, naming the bots', () => {
    const src = read('lib/seo/faq.ts');
    expect(/ai crawlers?/i.test(src), 'FAQ must mention AI crawlers').toBe(true);
    expect(src).toContain('GPTBot');
    expect(src).toContain('ClaudeBot');
  });

  it("the js_rendered finding reframes the static read as the edge (ChatGPT + Claude don't run JS)", () => {
    const src = read('components/audit/finding-meta.ts');
    expect(src).toContain('ChatGPT');
    expect(src).toContain('Claude');
    expect(/javascript/i.test(src)).toBe(true);
  });
});

describe('SPEC 03 copy — HARD BOUNDARY: no AI-readiness score is implied', () => {
  for (const rel of NO_SCORE_SURFACES) {
    it(`${rel} does not imply an AI-readiness score`, () => {
      const src = read(rel);
      for (const re of SCORE_PATTERNS) {
        expect(re.test(src), `${rel} must not imply an AI-readiness score (${re})`).toBe(false);
      }
    });
  }
});

describe('SPEC 03 copy — honesty: conversion surfaces never promise rankings/traffic', () => {
  for (const rel of HONESTY_SURFACES) {
    it(`${rel} contains no rankings/traffic promise`, () => {
      const src = read(rel);
      for (const re of PROMISE_PATTERNS) {
        expect(re.test(src), `${rel} should not contain a rankings/traffic promise (${re})`).toBe(false);
      }
    });
  }

  it('the gap is framed as a GRADE claim with an honest recrawl/re-rank timeline', () => {
    const src = read('components/audit/GapPanel.tsx');
    // \s+ tolerates JSX line-wrapping in the source ("...traffic\n  forecast...").
    expect(/not a traffic\s+forecast/i.test(src), 'gap must disclaim being a traffic forecast').toBe(true);
    expect(/recrawl/i.test(src), 'gap must set an honest recrawl timeline').toBe(true);
    expect(/re-?rank/i.test(src), 'gap must mention re-ranking taking time').toBe(true);
  });
});
