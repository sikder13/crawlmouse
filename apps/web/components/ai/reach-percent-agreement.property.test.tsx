import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PageAiSignals, AiReadinessClient } from '@crawlmouse/types';
// DEEP, TEST-ONLY IMPORTS of the engine source. `assembleAiReadiness` is not on the engine barrel and
// must not go on it just for a test — and `ai-view-logic.ts` is imported by a `'use client'` component,
// so the engine must never reach it through PRODUCTION code (the A9 defect). A test file is not bundled,
// so binding both real implementations here is the one place this comparison can honestly be made.
import { assembleAiReadiness, type AiReadinessInput, type AiReadinessPage } from '../../../../packages/engine/src/analysis/ai-readiness/assemble';
import { parseRobotsTxt } from '../../../../packages/engine/src/robots';
import { parseLlmsTxt } from '../../../../packages/engine/src/analysis/ai-readiness/llms-txt';
import { AiReadinessSection } from './AiReadinessSection';

/**
 * THE ROUND-3 BLOCKER, PINNED AS A PROPERTY.
 *
 * The access card and the finding six lines below it are TWO SEPARATE COMPUTATIONS of one number: the
 * engine builds the finding's display string from `allowedPageRatio` (`assemble.ts`), and the card
 * recomputes it from the same ratio (`reachPercent`). They drifted — the engine rounded, the card
 * floored — so a site with one `Disallow:` rule matching one crawled path rendered
 *
 *     CARD    "OpenAI (OAI-SearchBot) — reaches 99% of your pages"
 *     FINDING "OpenAI's OAI-SearchBot can reach only 100% of your pages"
 *
 * on the same screen, and on the permanent public report. Measured before the fix: the two disagreed on
 * 1258 of 2406 ordinary (pages, disallowed-paths) pairs.
 *
 * WHY A PROPERTY TEST AND NOT FIXTURES. Fixtures are precisely what missed this for three review rounds
 * — every real audit in production has `allowedPageRatio` of exactly 0 or 1, so no fixture drawn from
 * real data, and no render against a real audit, can reach the disagreeing region at all. Only sweeping
 * the ratio finds it.
 *
 * WHY IT DRIVES THE REAL ENGINE. Both numbers are extracted from RENDERED HTML, and the finding text
 * comes from `assembleAiReadiness` over a real parsed robots.txt — no formula is retyped here. Asserting
 * each side separately against a written-out `Math.floor(r * 100)` would just restate each
 * implementation and would have passed happily while they disagreed with each other.
 *
 * The durable fix is one source of truth instead of two computations — logged as FU-12k.
 */

const HOST = 'https://ex.com';

function sig(): PageAiSignals {
  return {
    pageClass: 'readable', mainTextChars: 500, title: 'T', excerpt: 'e', csrSignals: [],
    frameworkMarker: null, hasTitle: true, hasMetaDescription: true, h1Count: 1,
    headingLevelsSkipped: false, hasMainLandmark: true,
    jsonLd: { present: true, valid: true, types: ['Organization'], hasEntityType: true },
  };
}

/** `blocked` of `total` crawled paths sit under /x, which robots.txt disallows for OAI-SearchBot only. */
function scoreFor(total: number, blocked: number) {
  const pages: AiReadinessPage[] = Array.from({ length: total }, (_, i) => ({
    url: i < blocked ? `${HOST}/x/p${i}` : `${HOST}/ok/p${i}`,
    title: `P${i}`,
    aiSignals: sig(),
  }));
  const robots = parseRobotsTxt('User-agent: OAI-SearchBot\nDisallow: /x\n\nUser-agent: *\nAllow: /\n');
  const input: AiReadinessInput = {
    pages,
    depths: new Map(pages.map((p) => [p.url, 1])),
    orphanSet: new Set(),
    jsRendered: false,
    robots,
    wafDetected: false,
    wafNote: null,
    llmsTxt: parseLlmsTxt(0, ''),
    confidence: 'high',
    partial: false,
    homepageUrl: pages[0]!.url,
  };
  return assembleAiReadiness(input)!;
}

const client = (score: ReturnType<typeof scoreFor>): AiReadinessClient =>
  ({
    score, homepageView: null, whatAiSees: null, aiPackets: null,
    hasMoreAiPackets: false, totalFindings: score.findings.length, whatAiSeesTotalPages: 1,
  }) as unknown as AiReadinessClient;

/** The two numbers a reader actually sees, read back out of the rendered document. */
function renderedPercents(total: number, blocked: number) {
  const score = scoreFor(total, blocked);
  const bot = score.accessMatrix.bots.find((b) => b.token === 'OAI-SearchBot')!;
  const html = renderToStaticMarkup(<AiReadinessSection aiReadiness={client(score)} auditId="a" />);
  // The operator/token sits in its own <span>, so the share follows a closing tag — a `[^<]*` gap here
  // silently matched nothing and made the assertion vacuous on the first run.
  const card = /OAI-SearchBot\)<\/span>[^<]*?reaches (\d+)% of your pages/.exec(html);
  const finding = /OAI-SearchBot can reach only (\d+)% of your pages/.exec(html);
  return {
    ratio: bot.allowedPageRatio,
    card: card ? Number(card[1]) : null,
    finding: finding ? Number(finding[1]) : null,
    html,
  };
}

describe('the access card and the finding must quote the SAME percentage (round-3 blocker)', () => {
  it('agrees across the whole 0..1 ratio range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 220 }).chain((total) =>
          fc.tuple(fc.constant(total), fc.integer({ min: 0, max: total })),
        ),
        ([total, blocked]) => {
          const { ratio, card, finding } = renderedPercents(total, blocked);

          if (ratio >= 1) {
            // Fully reaching: it belongs in the reach group and the engine emits no blocked finding.
            expect(finding, `ratio 1 must not produce a blocked finding`).toBeNull();
            expect(card, `a full-reach bot must not be rendered with a restriction share`).toBeNull();
            return;
          }
          // Restricted: BOTH surfaces must speak, and must say the same thing.
          expect(card, `${blocked}/${total}: the card must state a share`).not.toBeNull();
          expect(finding, `${blocked}/${total}: the engine must emit a blocked finding`).not.toBeNull();
          expect(
            card,
            `${blocked} of ${total} disallowed (ratio ${ratio}): card says ${card}%, finding says ${finding}% — on the same screen`,
          ).toBe(finding);
          // …and neither may claim full reach for a bot the page calls restricted.
          expect(card, `a RESTRICTED bot must never render as reaching 100%`).toBeLessThan(100);
        },
      ),
      {
        numRuns: 60,
        // The pairs measured to diverge under round-vs-floor. Pinned so the regression is deterministic
        // and does not depend on the shrinker happening to find them again.
        examples: [[[419, 1]], [[300, 1]], [[500 - 100, 1]], [[200, 1]], [[419, 419]], [[419, 0]]],
      },
    );
  });

  it('the ratio itself is untouched by the display fix — floor is DISPLAY ONLY', () => {
    // Grade/score neutrality, asserted rather than asserted-about: the component subscore and the
    // persisted ratio come from the unrounded value and must not move with the display rule.
    const { ratio } = renderedPercents(419, 1);
    expect(ratio).toBe(418 / 419);
    const s = scoreFor(419, 1);
    // access subscore = mean ratio over the six RETRIEVAL bots; five reach fully, one is at 418/419.
    expect(s.components.access.score).toBeCloseTo((5 + 418 / 419) / 6, 12);
    expect(s.components.access.weight).toBe(25);
  });
});
