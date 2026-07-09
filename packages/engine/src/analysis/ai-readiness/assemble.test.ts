import { describe, it, expect } from 'vitest';
import type { PageAiSignals } from '@crawlmouse/types';
import { assembleAiReadiness, type AiReadinessInput, type AiReadinessPage } from './assemble.js';
import { parseRobotsTxt } from '../../robots.js';
import { parseLlmsTxt } from './llms-txt.js';

const HOME = 'https://ex.com/';

function sig(overrides: Partial<PageAiSignals> = {}): PageAiSignals {
  return {
    pageClass: 'readable',
    mainTextChars: 500,
    excerpt: 'excerpt',
    csrSignals: [],
    frameworkMarker: null,
    hasTitle: true,
    hasMetaDescription: true,
    h1Count: 1,
    headingLevelsSkipped: false,
    hasMainLandmark: true,
    jsonLd: { present: true, valid: true, types: ['Organization'] },
    ...overrides,
  };
}
function page(url: string, s: Partial<PageAiSignals> = {}): AiReadinessPage {
  return { url, title: url, aiSignals: sig(s) };
}
function input(overrides: Partial<AiReadinessInput> = {}): AiReadinessInput {
  return {
    pages: [page(HOME)],
    depths: new Map([[HOME, 0]]),
    orphanSet: new Set(),
    jsRendered: false,
    robots: null,
    wafDetected: false,
    wafNote: null,
    llmsTxt: parseLlmsTxt(0, ''),
    confidence: 'high',
    partial: false,
    homepageUrl: HOME,
    ...overrides,
  };
}
const findingKinds = (r: NonNullable<ReturnType<typeof assembleAiReadiness>>) => r.findings.map((f) => f.kind);

describe('assembleAiReadiness — null-assembly rule (Amendment §2)', () => {
  it('returns null when there are no eligible pages with signals', () => {
    expect(assembleAiReadiness(input({ pages: [] }))).toBeNull();
  });
});

describe('assembleAiReadiness — score assembly (§7, A10)', () => {
  it('a perfect single-page site scores 100 / ready', () => {
    const r = assembleAiReadiness(input())!;
    expect(r.score).toBe(100);
    expect(r.band).toBe('ready');
    expect(r.components).toEqual({
      access: { score: 1, weight: 25 },
      contentWithoutJs: { score: 1, weight: 40 },
      machineLegibility: { score: 1, weight: 20 },
      retrievalPath: { score: 1, weight: 15 },
    });
    expect(r.basis).toEqual({ pagesAnalyzed: 1, siteJsRendered: false, retrievalPathBasis: 'full' });
    expect(r.asOf).toBe('2026-07-01');
  });

  it('mirrors confidence + frames as an estimate on a low-confidence / partial crawl', () => {
    expect(assembleAiReadiness(input({ confidence: 'high', partial: false }))!.isEstimate).toBe(false);
    expect(assembleAiReadiness(input({ confidence: 'low' }))!.isEstimate).toBe(true);
    expect(assembleAiReadiness(input({ partial: true }))!.isEstimate).toBe(true);
    expect(assembleAiReadiness(input({ confidence: 'medium' }))!.confidence).toBe('medium');
  });

  it('bands: ready ≥80, partial 50–79, at_risk <50', () => {
    // A js_blind site tanks the flagship (weight 40) → at_risk.
    const blind = assembleAiReadiness(input({ pages: [page(HOME, { pageClass: 'js_blind', mainTextChars: 0 })] }))!;
    expect(blind.band).toBe('at_risk');
    expect(blind.score).toBeLessThan(50);
  });

  it('is deterministic: identical input → identical output', () => {
    expect(assembleAiReadiness(input())).toEqual(assembleAiReadiness(input()));
  });
});

describe('assembleAiReadiness — content-without-JS (§4.3)', () => {
  it('js_blind / partial pages produce findings + lower the flagship subscore', () => {
    const r = assembleAiReadiness(
      input({
        pages: [page(HOME), page(`${HOME}a`, { pageClass: 'js_blind', mainTextChars: 0 }), page(`${HOME}b`, { pageClass: 'partial', mainTextChars: 120 })],
        depths: new Map([[HOME, 0], [`${HOME}a`, 1], [`${HOME}b`, 1]]),
      }),
    )!;
    expect(r.components.contentWithoutJs.score).toBeCloseTo((1 + 0 + 0.5) / 3, 10);
    expect(findingKinds(r)).toContain('js_blind_page');
    expect(findingKinds(r)).toContain('partial_js_page');
  });
});

describe('assembleAiReadiness — access matrix (§3, A5/A6)', () => {
  it('blocking a RETRIEVAL bot lowers the access subscore + emits a high finding', () => {
    const robots = parseRobotsTxt('User-agent: OAI-SearchBot\nDisallow: /');
    const r = assembleAiReadiness(input({ robots }))!;
    const oai = r.accessMatrix.bots.find((b) => b.token === 'OAI-SearchBot')!;
    expect(oai.allowedPageRatio).toBe(0);
    expect(oai.fullyBlocked).toBe(true);
    expect(r.components.access.score).toBeCloseTo(5 / 6, 10); // one of six retrieval bots blocked
    expect(findingKinds(r)).toContain('retrieval_bot_blocked');
  });

  it('blocking a TRAINING bot does NOT change the score — reported, not scored (A6)', () => {
    const robots = parseRobotsTxt('User-agent: GPTBot\nDisallow: /');
    const r = assembleAiReadiness(input({ robots }))!;
    expect(r.components.access.score).toBe(1); // retrieval mean unaffected
    const gpt = r.accessMatrix.bots.find((b) => b.token === 'GPTBot')!;
    expect(gpt.allowedPageRatio).toBe(0);
    expect(gpt.botClass).toBe('training');
    expect(findingKinds(r)).toContain('training_bot_blocked');
    expect(findingKinds(r)).not.toContain('retrieval_bot_blocked');
  });

  it('no robots.txt ⇒ all ratios 1.0, robotsTxtFound false', () => {
    const r = assembleAiReadiness(input({ robots: null }))!;
    expect(r.accessMatrix.robotsTxtFound).toBe(false);
    expect(r.accessMatrix.bots.every((b) => b.allowedPageRatio === 1)).toBe(true);
    expect(r.components.access.score).toBe(1);
  });

  it('opt-out tokens are described as tokens (Google-Extended / Applebot-Extended)', () => {
    const r = assembleAiReadiness(input())!;
    const g = r.accessMatrix.bots.find((b) => b.token === 'Google-Extended')!;
    expect(g.botClass).toBe('opt_out_token');
    expect(g.note).toMatch(/opt-out/i);
  });

  it('carries the WAF disclosure through without moving the score (A7)', () => {
    const withWaf = assembleAiReadiness(input({ wafDetected: true, wafNote: 'Cloudflare edge…' }))!;
    const noWaf = assembleAiReadiness(input({ wafDetected: false, wafNote: null }))!;
    expect(withWaf.accessMatrix.wafDetected).toBe(true);
    expect(withWaf.score).toBe(noWaf.score); // disclosure only
  });
});

describe('assembleAiReadiness — retrieval path (§6, A8)', () => {
  it('a readable orphan → readable_but_orphaned finding + lower retrieval subscore', () => {
    const orphan = `${HOME}orphan`;
    const r = assembleAiReadiness(
      input({
        pages: [page(HOME), page(orphan)],
        depths: new Map([[HOME, 0], [orphan, 2]]),
        orphanSet: new Set([orphan]),
      }),
    )!;
    expect(findingKinds(r)).toContain('readable_but_orphaned');
    expect(r.components.retrievalPath.score).toBeCloseTo(1 / 2, 10); // home good, orphan bad
    expect(r.basis.retrievalPathBasis).toBe('full');
  });

  it('a readable page buried past depth 3 → readable_but_deep', () => {
    const deep = `${HOME}deep`;
    const r = assembleAiReadiness(
      input({ pages: [page(HOME), page(deep)], depths: new Map([[HOME, 0], [deep, 5]]), orphanSet: new Set() }),
    )!;
    expect(findingKinds(r)).toContain('readable_but_deep');
  });

  it('on a JS-rendered site the orphan signal is suppressed → depth_only basis, no orphan finding', () => {
    const orphan = `${HOME}orphan`;
    const r = assembleAiReadiness(
      input({
        jsRendered: true,
        pages: [page(HOME), page(orphan)],
        depths: new Map([[HOME, 0], [orphan, 2]]),
        orphanSet: new Set([orphan]), // present, but must be IGNORED on a JS site
      }),
    )!;
    expect(r.basis.retrievalPathBasis).toBe('depth_only');
    expect(findingKinds(r)).not.toContain('readable_but_orphaned');
    expect(r.components.retrievalPath.score).toBe(1); // both shallow; orphan ignored
  });
});

describe('assembleAiReadiness — llms.txt zero weight (§8, A9)', () => {
  it('score is IDENTICAL with and without llms.txt (only the finding differs)', () => {
    const absent = assembleAiReadiness(input({ llmsTxt: parseLlmsTxt(0, '') }))!;
    const present = assembleAiReadiness(input({ llmsTxt: parseLlmsTxt(200, '# X\n- [a](https://x.co)') }))!;
    expect(present.score).toBe(absent.score);
    expect(findingKinds(absent)).toContain('llms_txt_absent');
    expect(findingKinds(present)).not.toContain('llms_txt_absent');
    expect(present.llmsTxt.present).toBe(true);
  });
});

describe('assembleAiReadiness — finding ids are stable + unique (§7 history-ready)', () => {
  it('the same problem on the same page yields the same id across runs', () => {
    const build = () => assembleAiReadiness(input({ pages: [page(HOME, { pageClass: 'js_blind', mainTextChars: 0 })], depths: new Map([[HOME, 0]]) }))!;
    const a = build().findings.find((f) => f.kind === 'js_blind_page')!;
    const b = build().findings.find((f) => f.kind === 'js_blind_page')!;
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('emits a UNIQUE id per blocked bot — site-level bot findings must not collide (§7 diffing)', () => {
    const robots = parseRobotsTxt('User-agent: *\nDisallow: /'); // blocks every bot via the * group
    const r = assembleAiReadiness(input({ robots }))!;
    const botFindings = r.findings.filter((f) => f.kind === 'retrieval_bot_blocked' || f.kind === 'training_bot_blocked');
    expect(botFindings.length).toBeGreaterThanOrEqual(6);
    const ids = botFindings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length); // all distinct
  });
});

describe('assembleAiReadiness — evidence labels (§2, non-negotiable)', () => {
  it('every finding carries the label §2 assigns to its kind', () => {
    const EXPECT: Record<string, string> = {
      js_blind_page: 'strong',
      partial_js_page: 'strong',
      retrieval_bot_blocked: 'strong',
      training_bot_blocked: 'strong',
      readable_but_orphaned: 'strong',
      readable_but_deep: 'strong',
      missing_structured_data: 'contested',
      invalid_structured_data: 'contested',
      heading_structure: 'moderate',
      missing_metadata: 'moderate',
      missing_entity_link: 'moderate',
      thin_page: 'info',
      llms_txt_absent: 'informational',
    };
    const robots = parseRobotsTxt('User-agent: OAI-SearchBot\nDisallow: /\nUser-agent: GPTBot\nDisallow: /');
    const r = assembleAiReadiness(
      input({
        robots,
        homepageUrl: HOME,
        pages: [
          page(HOME, { pageClass: 'js_blind', mainTextChars: 0, jsonLd: { present: false, valid: false, types: [] } }),
          page(`${HOME}a`, {
            pageClass: 'partial',
            mainTextChars: 100,
            hasTitle: false,
            hasMetaDescription: false,
            h1Count: 2,
            headingLevelsSkipped: true,
            hasMainLandmark: false,
            jsonLd: { present: true, valid: false, types: [] },
          }),
          page(`${HOME}b`, { jsonLd: { present: false, valid: false, types: [] } }), // readable, missing structured data
          page(`${HOME}orphan`),
          page(`${HOME}deep`),
        ],
        depths: new Map([[HOME, 0], [`${HOME}a`, 1], [`${HOME}b`, 1], [`${HOME}orphan`, 2], [`${HOME}deep`, 5]]),
        orphanSet: new Set([`${HOME}orphan`]),
      }),
    )!;
    for (const f of r.findings) expect(EXPECT[f.kind], `${f.kind} label`).toBe(f.evidence);
    expect(new Set(r.findings.map((f) => f.kind)).size).toBeGreaterThanOrEqual(8); // a real spread of kinds
  });
});

describe('assembleAiReadiness — band + weight pins (§7)', () => {
  it('an all-partial site lands in the PARTIAL band and pins the weight split (M2 fix)', () => {
    // 2 partial pages with clean legibility + Org entity, no robots. content 0.5, legibility 1.0,
    // access 1.0, retrieval = 0.5 (empty readable/thin → NEUTRAL, not 1.0). score = 25+20+20+7.5 = 73.
    const r = assembleAiReadiness(
      input({
        pages: [page(HOME, { pageClass: 'partial', mainTextChars: 120 }), page(`${HOME}a`, { pageClass: 'partial', mainTextChars: 120 })],
        depths: new Map([[HOME, 0], [`${HOME}a`, 1]]),
      }),
    )!;
    expect(r.components.retrievalPath.score).toBe(0.5); // NEUTRAL empty-set (not 1.0)
    expect(r.score).toBe(73);
    expect(r.band).toBe('partial');
  });

  it('an all-js_blind site stays at_risk (legibility empty → 0; the honest shell verdict)', () => {
    const r = assembleAiReadiness(
      input({
        pages: [page(HOME, { pageClass: 'js_blind', mainTextChars: 0 }), page(`${HOME}a`, { pageClass: 'js_blind', mainTextChars: 0 })],
        depths: new Map([[HOME, 0], [`${HOME}a`, 1]]),
      }),
    )!;
    expect(r.components.contentWithoutJs.score).toBe(0);
    expect(r.band).toBe('at_risk');
  });
});
