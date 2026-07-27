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

// SPEC 05 shipped the AI-readiness score. These surfaces now LEGITIMATELY render it — they stay bound by
// the rankings/traffic + A16 honesty rules below, but are EXEMPT from the "no score implied" boundary.
const AI_SURFACES = [
  'components/ai/AiReadinessSection.tsx',
  'components/ai/HomepageAiView.tsx',
  'components/ai/WhatAiSeesSimulator.tsx',
  'components/ai/AiPacketList.tsx',
  'components/ai/AiPacketCopy.tsx',
  'components/ai/LlmsTxtGenerator.tsx',
  'components/ai/ai-view-logic.ts',
  'lib/llms-txt.ts',
  // The Stage-4 packet builder: its static System/Task strings ship inside every Pro-owner packet body.
  'lib/ai-readiness-packets.ts',
  // SPEC 05 §10 — the report's AI section. This is the most CLIENT-FACING copy of the lot (it ships
  // inside a shareable, indexable, printable report), so it is bound by the A16 + rankings/traffic rules.
  'components/report/AiReadinessReportSection.tsx',
] as const;

// Conversion + AI surfaces — none may promise rankings/traffic.
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
  // SPEC 04 §2 — the wait-experience surfaces (must never promise rankings/traffic).
  'components/audit/AuditProgress.tsx',
  'components/audit/ActivityFeed.tsx',
  'components/audit/EmailWhenDone.tsx',
  'components/audit/EducationalCards.tsx',
  // SPEC 04 §4 — the client-ready public report surfaces.
  'lib/report-content.ts',
  'components/report/sections.tsx',
  // SPEC 05 — the AI-readiness surfaces are score-bearing but still bound by the rankings/traffic ban.
  ...AI_SURFACES,
] as const;

// Marketing + linking-grade surfaces that must NOT imply an AI-readiness score exists in THEIR copy (the
// score lives only in the dedicated SPEC 05 AI section). ResultView + AI_SURFACES are score-bearing now and
// are EXEMPT — the SPEC-03-era "no score anywhere" boundary was retired for them when SPEC 05 shipped.
const NO_SCORE_SURFACES = [
  'app/page.tsx',
  'app/pricing/page.tsx',
  'app/login/page.tsx',
  'components/billing/PricingCards.tsx',
  'components/audit/GapPanel.tsx',
  'components/audit/GradeReveal.tsx',
  'components/audit/FreeFixCard.tsx',
  'components/audit/CureWall.tsx',
  'components/audit/SaveAndMonitorCta.tsx',
  'components/audit/FindingsPanel.tsx',
  'components/audit/finding-meta.ts',
  'lib/seo/faq.ts',
  'components/audit/graph-logic.ts',
  'components/audit/LinkGraphSlot.tsx',
  'components/audit/LinkGraph.tsx',
] as const;

// A16 — banned AI-claims, checked across ALL copy surfaces (marketing + AI). POSITIVE-promise forms only
// (like PROMISE_PATTERNS), so honest negated/capability copy — "doesn't change how you rank or get cited" —
// never trips. We sell machine-legibility & discoverability, NEVER AI rankings or guaranteed citations.
const AI_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bai\s+rankings?\b/i,
  /improve[sd]?\s+(your\s+)?ai[-\s]?rank/i,
  /guarantee[ds]?\s+(ai\s+)?(citation|cited)/i,
  /will\s+be\s+cited\s+by/i,
];
const ALL_COPY_SURFACES = [...new Set<string>([...HONESTY_SURFACES, ...NO_SCORE_SURFACES])];

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

  it('the link graph carries the honest jsOnly reachability story (a REACHABILITY signal, not "this page is JS")', () => {
    const src = read('components/audit/graph-logic.ts');
    expect(/no static link path/i.test(src), 'graph jsOnly copy must be reachability-framed').toBe(true);
    expect(/ai crawlers?/i.test(src)).toBe(true);
    expect(src).toMatch(/ChatGPT|Claude/);
    // Must NOT mislabel a jsOnly node as literally being JavaScript.
    expect(/this page is javascript/i.test(src)).toBe(false);
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

// SPEC 05 §2/§16 — A16: no surface (marketing OR the new AI surfaces) may promise AI rankings or guaranteed
// citations. Complements the "no score implied" boundary above, which SPEC 05 narrowed to non-AI surfaces.
describe('SPEC 05 copy — A16: no banned AI-claims (rankings / guaranteed citations)', () => {
  for (const rel of ALL_COPY_SURFACES) {
    it(`${rel} makes no banned AI-claim`, () => {
      const src = read(rel);
      for (const re of AI_CLAIM_PATTERNS) {
        expect(re.test(src), `${rel} must not claim AI rankings / guaranteed citations (${re})`).toBe(false);
      }
    });
  }

  it('the AI surfaces all exist and are checked (fail-loud, no silently-skipped surface)', () => {
    for (const rel of AI_SURFACES) {
      expect(() => read(rel), `${rel} must exist to be honesty-checked`).not.toThrow();
    }
  });
});
