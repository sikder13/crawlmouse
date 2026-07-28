import { describe, it, expect } from 'vitest';
import type { PageAiSignals } from '@crawlmouse/types';
import { assembleAiReadiness, type AiReadinessInput, type AiReadinessPage } from './assemble.js';
import { parseRobotsTxt } from '../../robots.js';
import { parseLlmsTxt } from './llms-txt.js';
import { AI_TEXT_MAX_BYTES, AI_TITLE_MAX_BYTES, AI_URL_MAX_BYTES } from './constants.js';

const HOME = 'https://ex.com/';

function sig(overrides: Partial<PageAiSignals> = {}): PageAiSignals {
  return {
    pageClass: 'readable',
    mainTextChars: 500, title: 'Fixture Title',
    excerpt: 'excerpt',
    csrSignals: [],
    frameworkMarker: null,
    hasTitle: true,
    hasMetaDescription: true,
    h1Count: 1,
    headingLevelsSkipped: false,
    hasMainLandmark: true,
    jsonLd: { present: true, valid: true, types: ['Organization'], hasEntityType: true },
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
      thin_page: 'strong',
      llms_txt_absent: 'informational',
    };
    const robots = parseRobotsTxt('User-agent: OAI-SearchBot\nDisallow: /\nUser-agent: GPTBot\nDisallow: /');
    const r = assembleAiReadiness(
      input({
        robots,
        homepageUrl: HOME,
        pages: [
          page(HOME, { pageClass: 'js_blind', mainTextChars: 0, jsonLd: { present: false, valid: false, types: [], hasEntityType: false } }),
          page(`${HOME}a`, {
            pageClass: 'partial',
            mainTextChars: 100,
            hasTitle: false,
            hasMetaDescription: false,
            h1Count: 2,
            headingLevelsSkipped: true,
            hasMainLandmark: false,
            jsonLd: { present: true, valid: false, types: [], hasEntityType: false },
          }),
          page(`${HOME}b`, { jsonLd: { present: false, valid: false, types: [], hasEntityType: false } }), // readable, missing structured data
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

  it('pins the exact weight SPLIT with FOUR DISTINCT subscores (a formula weight/component mispairing fails)', () => {
    // access 0.5 (3 of 6 retrieval bots blocked), content 1.0 (all readable), legibility 0.7875
    // (perPage 0.75 · 0.85 + entity 1 · 0.15), retrieval 0.25 (only the non-orphan homepage is reachable).
    // score = 25·0.5 + 40·1 + 20·0.7875 + 15·0.25 = 12.5 + 40 + 15.75 + 3.75 = 72. All four distinct →
    // swapping ANY two weights changes the result (closes the intra-equal-value gap).
    const half = { hasTitle: true, hasMetaDescription: true, hasMainLandmark: true, h1Count: 0, headingLevelsSkipped: true, jsonLd: { present: false, valid: false, types: [], hasEntityType: false } };
    const robots = parseRobotsTxt('User-agent: OAI-SearchBot\nDisallow: /\nUser-agent: ChatGPT-User\nDisallow: /\nUser-agent: Claude-SearchBot\nDisallow: /');
    const r = assembleAiReadiness(
      input({
        robots,
        homepageUrl: HOME,
        pages: [page(HOME), page(`${HOME}b`), page(`${HOME}c`, half), page(`${HOME}d`, half)],
        depths: new Map([[HOME, 0], [`${HOME}b`, 1], [`${HOME}c`, 1], [`${HOME}d`, 1]]),
        orphanSet: new Set([`${HOME}b`, `${HOME}c`, `${HOME}d`]), // 3 of 4 readable pages orphaned
      }),
    )!;
    expect(r.components.access.score).toBeCloseTo(0.5, 10);
    expect(r.components.contentWithoutJs.score).toBe(1);
    expect(r.components.machineLegibility.score).toBeCloseTo(0.7875, 10);
    expect(r.components.retrievalPath.score).toBeCloseTo(0.25, 10);
    expect(r.score).toBe(72);
    expect(r.band).toBe('partial');
  });

  it('pins the READY band boundary (a score of exactly 80 is ready, not partial)', () => {
    // Single readable homepage that fails EVERY legibility check + has no entity → legibility 0; content 1,
    // retrieval 1, access 1 → 25 + 40 + 0 + 15 = 80. Pins `>= 80` (an `> 80` mutation would call it partial).
    const bare = { hasTitle: false, hasMetaDescription: false, hasMainLandmark: false, h1Count: 0, headingLevelsSkipped: true, jsonLd: { present: false, valid: false, types: [], hasEntityType: false } };
    const r = assembleAiReadiness(input({ pages: [page(HOME, bare)], depths: new Map([[HOME, 0]]) }))!;
    expect(r.score).toBe(80);
    expect(r.band).toBe('ready');
  });
});

// ── CAP AT THE SOURCE + the honest pre-cap total ─────────────────────────────────────────────────
// Every crawled string on an AiFinding is bounded where the finding is BUILT. Downstream caps
// (persist, projection, snapshot) are defense-in-depth. Capping only downstream is what let a
// 500-finding cap serialise to 99.76 MB: the count was bounded, the per-item title axis was not.
describe('assembleAiReadiness — crawled strings are bounded AT THE SOURCE', () => {
  const sig = (over: Partial<PageAiSignals> = {}): PageAiSignals => ({
    pageClass: 'readable', mainTextChars: 500, title: 'T', excerpt: 'e', csrSignals: [],
    frameworkMarker: null, hasTitle: true, hasMetaDescription: false, h1Count: 3,
    headingLevelsSkipped: true, hasMainLandmark: false,
    jsonLd: { present: false, valid: false, types: [], hasEntityType: false }, ...over,
  });
  const run = (pages: { url: string; title: string | null; aiSignals: PageAiSignals }[]) =>
    assembleAiReadiness({
      pages,
      depths: new Map(pages.map((p, i) => [p.url, i === 0 ? 0 : 2])),
      orphanSet: new Set(), jsRendered: false, robots: null, wafDetected: false, wafNote: null,
      llmsTxt: { present: false, parseable: false, note: 'n' }, confidence: 'high', partial: false,
      homepageUrl: pages[0]!.url,
    })!;

  it('caps targetTitle, targetUrl and plainLanguage on every finding', () => {
    const score = run([
      { url: `https://ex.com/${'u'.repeat(5000)}`, title: 'X'.repeat(200_000), aiSignals: sig() },
    ]);
    expect(score.findings.length).toBeGreaterThan(0);
    for (const f of score.findings) {
      if (f.targetTitle != null) expect(Buffer.byteLength(f.targetTitle, 'utf8')).toBeLessThanOrEqual(AI_TITLE_MAX_BYTES);
      if (f.targetUrl != null) expect(Buffer.byteLength(f.targetUrl, 'utf8')).toBeLessThanOrEqual(AI_URL_MAX_BYTES);
      expect(Buffer.byteLength(f.plainLanguage, 'utf8')).toBeLessThanOrEqual(AI_TEXT_MAX_BYTES);
    }
  });

  it('stamps the honest pre-cap totalFindings — the producer of the whole honesty chain', () => {
    // Nothing asserted this before, so `totalFindings: 0` and `Math.min(findings.length, 500)` both
    // survived a green 541-test suite. Every downstream test injects the number into a fixture, so
    // all of them verified the PROPAGATION of a value nothing verified the PRODUCTION of.
    const pages = Array.from({ length: 40 }, (_, i) => ({
      url: `https://ex.com/p${i}`, title: `T${i}`, aiSignals: sig(),
    }));
    const score = run(pages);
    expect(score.totalFindings).toBe(score.findings.length);
    expect(score.totalFindings).toBeGreaterThan(40); // per page, per kind — genuinely more than one each
  });

  it('BYTE CEILING: the assembled score at PRO_PAGE_CAP with EVERY string axis worst-case', () => {
    // The measurement that mattered: 2000 pages x 200 000-char titles serialised to 100.16 MB before
    // source-capping, and the 500-finding cap removed 0.4% of it. Assert the BYTES, at full scale,
    // with the title, the url and the type list all maximal simultaneously.
    const bigTitle = 'X'.repeat(200_000);
    const pages = Array.from({ length: 2000 }, (_, i) => ({
      url: `https://ex.com/${'u'.repeat(3000)}/p${i}`,
      title: bigTitle,
      aiSignals: sig({ title: bigTitle, excerpt: 'e'.repeat(2000) }),
    }));
    const score = run(pages);
    const bytes = JSON.stringify(score).length;
    // The RAW score is transient — never written, never sent — and its size scales with the finding
    // COUNT, which is bounded separately at the write (AI_PERSIST_MAX_FINDINGS, asserted in
    // inngest/persist-helpers.test.ts). What source-capping owns is the PER-ITEM axis, so that is what
    // is asserted strictly here. Before source-capping the same fixture measured 100.16 MB.
    expect(bytes, `raw assembled score = ${bytes} bytes`).toBeLessThan(8_000_000);
    const perFinding = bytes / score.findings.length;
    expect(perFinding, `${perFinding.toFixed(0)} bytes/finding`).toBeLessThan(1_500);
  });

  it('bounds the accessMatrix notes and the llms.txt note too', () => {
    const score = run([{ url: 'https://ex.com/', title: 'T', aiSignals: sig() }]);
    score.accessMatrix.bots.forEach((b) => expect(Buffer.byteLength(b.note, 'utf8')).toBeLessThanOrEqual(AI_TEXT_MAX_BYTES));
    expect(Buffer.byteLength(score.llmsTxt.note, 'utf8')).toBeLessThanOrEqual(AI_TEXT_MAX_BYTES);
  });

  it('does NOT emit missing_entity_link when the homepage declares an entity past the type cap', () => {
    // The end-to-end shape of the blocking defect, asserted on the finding a user would actually see.
    const home = {
      url: 'https://ex.com/',
      title: 'Home',
      aiSignals: sig({
        jsonLd: {
          present: true, valid: true,
          types: Array.from({ length: 20 }, (_, i) => `Filler${i}`), // Organization evicted from storage
          hasEntityType: true,                                       // …but the signal knows better
        },
      }),
    };
    expect(run([home]).findings.some((f) => f.kind === 'missing_entity_link')).toBe(false);
  });
});
