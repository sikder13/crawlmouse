import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import type { AiReadinessClient } from '@crawlmouse/types';
import { ResultView } from './ResultView';
import { freeFixture } from './__fixtures__/client-audit-v2';

vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));

// The two markers are the sections' OWN accessibility anchors, not prose: the AI section labels its
// heading `ai-readiness-heading`, and the grade gauge carries an aria-label naming the fixture's
// grade. Asserting on POSITIONS means this file fails when the order changes and at no other time.
// The first test below checks both markers are actually present — a marker that silently stopped
// matching would make every position assertion vacuously true, which is how this file was wrong
// on its first run.
const AI = 'ai-readiness-heading';
const GRADE = 'aria-label="Grade C, 64 out of 100"';

const ai = {
  score: {
    score: 55,
    band: 'partial',
    components: {
      access: { score: 1, weight: 25 },
      contentWithoutJs: { score: 0.5, weight: 40 },
      machineLegibility: { score: 0.6, weight: 20 },
      retrievalPath: { score: 0.5, weight: 15 },
    },
    confidence: 'high',
    isEstimate: false,
    basis: { pagesAnalyzed: 3, siteJsRendered: false, retrievalPathBasis: 'full' },
    findings: [],
    accessMatrix: { bots: [], robotsTxtFound: true, wafDetected: false, wafNote: null },
    llmsTxt: { present: false, parseable: false, note: 'LLMS_NOTE' },
    asOf: '2026-07-01',
  },
  homepageView: { url: 'https://ex.com/', title: 'Home', pageClass: 'readable', excerpt: 'HOMEPAGE_WOW', mainTextChars: 800 },
  whatAiSees: null,
  aiPackets: null,
  hasMoreAiPackets: true,
  totalFindings: 0,
  whatAiSeesTotalPages: 3,
} as unknown as AiReadinessClient;

const withAi = { ...freeFixture, aiReadiness: ai };
const render = (audit: typeof freeFixture, view?: 'ai') =>
  renderToStaticMarkup(<ResultView audit={audit} view={view} />);

const BRIDGE = 'The internal-linking grade below';

describe('ResultView ordering', () => {
  it('the two markers exist, so a position assertion is meaningful', () => {
    const html = render(withAi, 'ai');
    expect(html, 'AI section anchor missing — the ordering assertions below would be vacuous').toContain(AI);
    expect(html, 'grade anchor missing — the ordering assertions below would be vacuous').toContain(GRADE);
  });

  it('(a) ?view=ai puts the AI-readiness section before the grade', () => {
    const html = render(withAi, 'ai');
    expect(html.indexOf(AI)).toBeLessThan(html.indexOf(GRADE));
  });

  it('(b) no param keeps the grade first and the AI section after it', () => {
    const html = render(withAi);
    expect(html.indexOf(GRADE)).toBeLessThan(html.indexOf(AI));
  });

  it('(c) ?view=ai on an audit with no aiReadiness falls back to the standard order', () => {
    const html = render(freeFixture, 'ai');
    expect(html).not.toContain(AI);
    expect(html).toContain(GRADE);
    // and it must not open on an empty hero — the bridge line belongs to the AI arc only
    expect(html).not.toContain(BRIDGE);
  });

  it('the bridge line appears in the AI arc, directly after the AI section, and nowhere else', () => {
    const aiHtml = render(withAi, 'ai');
    expect(aiHtml).toContain(BRIDGE);
    expect(aiHtml.indexOf(AI)).toBeLessThan(aiHtml.indexOf(BRIDGE));
    expect(aiHtml.indexOf(BRIDGE)).toBeLessThan(aiHtml.indexOf(GRADE));
    expect(render(withAi)).not.toContain(BRIDGE);
  });

  it('an unknown view value is treated as no view at all', () => {
    const html = render(withAi, 'sideways' as unknown as 'ai');
    expect(html.indexOf(GRADE)).toBeLessThan(html.indexOf(AI));
  });

  /**
   * The invariant the relay exists to protect. Reordering must be a REORDER: with no param the two
   * arcs contain exactly the same sections, and only their sequence differs. Comparing sorted marker
   * sets catches a section silently dropped from, or added to, one arc.
   */
  it('both arcs render the same set of sections — only the order differs', () => {
    const std = render(withAi);
    const aiFirst = render(withAi, 'ai');
    for (const marker of [AI, GRADE, 'Clean bill of health', 'Notes']) {
      const inStd = std.includes(marker);
      const inAi = aiFirst.includes(marker);
      expect(inAi, `"${marker}" present in one arc but not the other`).toBe(inStd);
    }
    // Same sections, so the AI arc differs only by the added bridge line.
    expect(aiFirst.length).toBeGreaterThan(std.length);
  });
});
