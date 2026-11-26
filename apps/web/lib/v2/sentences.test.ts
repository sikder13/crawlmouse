import { describe, expect, it } from 'vitest';
import {
  AccessCauseSchema,
  VerdictSchema,
  scoredCrawlersMeasured,
  CheckSchema,
  type Check,
  type Verdict,
  type WithheldReason,
} from '@crawlmouse/types/v2';
import { AI_WAITING } from './view/effect-headline';
import { MIN_MEASURED_CRAWLERS } from '../../../../packages/engine/src/v2/grade/weights';
import { findCheck, fixesAsOf, fixture } from './fixtures';
import { CHECKS } from './recordings';
import { TEMPLATE_NOUNS } from './format';
import {
  aiShortSummary,
  aiSummary,
  aiWithheldSummary,
  isAllowed,
  isBlocked,
  isSingularNoun,
  keptOutClauses,
  nextBandSentence,
  seoSummary,
  structureWord,
  thinSentence,
  I4_MEASURED_CRAWLERS,
} from './sentences';

const d = fixture('bad-site');
const check = findCheck(d, CHECKS.badFirstAudit);
const fixes = fixesAsOf(d, check);
const isOpen = (f: (typeof fixes)[number]) => fixes.indexOf(f) < 3;

describe('the sentences about a check', () => {
  it('words the fixes to the next band by how many are open', () => {
    const [a, b] = [
      fixes.find((f) => f.effect.technical_seo === 4)!,
      fixes.find((f) => f.effect.technical_seo === 2)!,
    ];
    expect(nextBandSentence(79, 'B', [a, b], () => true)).toBe(
      'Two fixes take it to A-; both are open now.',
    );
    expect(nextBandSentence(79, 'B', [a, b], () => false)).toBe(
      'Two fixes take it to A-; they are on Pro.',
    );
    expect(nextBandSentence(79, 'B', [a, b], (f) => f === a)).toBe(
      'Two fixes take it to A-; one of them is open now.',
    );
    expect(nextBandSentence(83, 'B+', [a], () => true)).toBe(
      'One fix takes it to A-; it is open now.',
    );
    expect(nextBandSentence(91, 'A', fixes, () => true)).toBeNull();
    expect(nextBandSentence(60, 'C', [b], () => true)).toBeNull();
  });

  it('says nothing about structure when the grade was refused, rather than calling it weak', () => {
    const refused: Check = {
      ...check,
      technical_seo: {
        ...check.technical_seo!,
        score: null,
        grade: null,
        site_structure_score: null,
      },
    };
    const s = seoSummary(refused, fixes, isOpen);
    expect(s).toBe('Seven pages nobody links to.');
    expect(s).not.toMatch(/structure/i);
  });

  it('keeps "blocked" for robots.txt and user-agent rules, groups crawlers sharing a fate, in the contract’s verdict order', () => {
    const c = (
      ua: string,
      verdict: Check['crawlers'][number]['verdict'],
      cause: Check['crawlers'][number]['cause'] = null,
    ) => ({
      ua,
      verdict,
      cause,
      evidence_class: 'simulated' as const,
      scored: true,
      group: 'ai_search' as const,
    });
    expect(
      keptOutClauses([
        c('A', 'challenged_ua'),
        c('B', 'disallowed_by_robots'),
        c('C', 'disallowed_by_robots'),
        c('D', 'allowed'),
      ]),
    ).toEqual(['B and C are blocked by robots.txt', 'A gets a challenge page']);
  });
});

/** A copy of the bad-site check with `edit` applied to it. */
const variant = (edit: (c: Check) => void): Check => {
  const c = structuredClone(check);
  edit(c);
  return c;
};
const crawler = (c: Check, ua: string) => c.crawlers.find((x) => x.ua === ua)!;
/** The crawler reads every template in full. */
const readsAll = (c: Check, ua: string) => {
  const r = crawler(c, ua);
  Object.assign(r, { verdict: 'allowed', cause: null, text_share: 0.95 });
  r.by_template.forEach((t) => (t.verdict = 'allowed'));
};
const SCORED_THIN = ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot'];

describe('thin templates, counted per crawler', () => {
  it('names a template thin to the scored crawlers only when a scored crawler reads it thin', () => {
    // The scored crawlers read every template in full; only unscored ClaudeBot reads one thin.
    const c = variant((c) => SCORED_THIN.forEach((ua) => readsAll(c, ua)));
    expect(crawler(c, 'ClaudeBot').by_template.map((t) => t.verdict)).toContain('allowed_thin');
    expect(aiSummary(c)).toBe('PerplexityBot gets a challenge page.');
    expect(thinSentence(c)).toBeNull();
    expect(aiShortSummary(c)).toBe('PerplexityBot gets a challenge page.');
  });

  it('says how many read it thin, and which, when not all the crawlers that got in do', () => {
    const c = variant((c) => readsAll(c, 'OAI-SearchBot'));
    expect(aiSummary(c)).toBe(
      'PerplexityBot gets a challenge page; product pages are empty to ChatGPT-User and Claude-SearchBot.',
    );
    // One scored crawler reads the product template in full, so it is not "empty without JavaScript".
    expect(thinSentence(c)).toBeNull();
  });

  it('says every scored crawler gets in, on the AI card and its short form, when none is kept out or reads thin', () => {
    const c = variant((c) => [...SCORED_THIN, 'PerplexityBot'].forEach((ua) => readsAll(c, ua)));
    const all = 'All four scored crawlers get in and read 95% of the text or more.';
    expect(aiSummary(c)).toBe(all);
    expect(aiShortSummary(c)).toBe(all);
  });

  it('says "all four" when no scored crawler is kept out and every one reads the template thin', () => {
    const c = variant((c) => {
      const like = crawler(c, 'OAI-SearchBot');
      Object.assign(crawler(c, 'PerplexityBot'), {
        verdict: like.verdict,
        cause: like.cause,
        text_share: like.text_share,
        by_template: structuredClone(like.by_template),
      });
    });
    expect(aiSummary(c)).toBe('Product pages are empty to all four.');
  });

  it('claims no text share it was not given, and says so when no scored crawler was tested', () => {
    const unknown = variant((c) => {
      [...SCORED_THIN, 'PerplexityBot'].forEach((ua) => readsAll(c, ua));
      crawler(c, 'ChatGPT-User').text_share = null;
    });
    expect(aiSummary(unknown)).toBe('All four scored crawlers get in.');
    const one = variant((c) => {
      readsAll(c, 'OAI-SearchBot');
      c.crawlers = c.crawlers.filter((x) => !x.scored || x.ua === 'OAI-SearchBot');
    });
    expect(aiSummary(one)).toBe(
      'The one scored crawler gets in and reads 95% of the text or more.',
    );
    const none = variant((c) => (c.crawlers = c.crawlers.filter((x) => !x.scored)));
    expect(aiSummary(none)).toBe('No scored AI crawler was tested.');
    expect(aiShortSummary(none)).toBe('No scored AI crawler was tested.');
  });

  it('agrees the verb with a single template, and the homepage is the one singular page noun', () => {
    const c = variant((c) => {
      for (const ua of SCORED_THIN) {
        crawler(c, ua).by_template.forEach(
          (t) => (t.verdict = t.template_key === '/' ? 'allowed_thin' : 'allowed'),
        );
      }
    });
    expect(thinSentence(c)).toBe('The homepage is empty without JavaScript.');
    expect(aiSummary(c)).toBe(
      'PerplexityBot gets a challenge page; the homepage is empty to the other three.',
    );
    for (const [label, noun] of Object.entries(TEMPLATE_NOUNS)) {
      expect(isSingularNoun(noun.pages), label).toBe(label === 'Homepage');
    }
  });
});

describe('the Technical SEO sentence with nothing to fix', () => {
  it('says no fix raises the grade, not that nothing lowers it', () => {
    const clean = fixture('clean-site');
    const c = findCheck(clean, CHECKS.cleanFirstAudit);
    const none = fixesAsOf(clean, c);
    expect(none).toHaveLength(0);
    const said = seoSummary(c, none, () => true);
    expect(said).toMatch(/No fix in this audit raises it\.$/);
    expect(said).not.toMatch(/lowers/);
  });
});

describe('the wording at each threshold and form', () => {
  const seo = (points: number) =>
    fixes.find((f) => f.effect.technical_seo === points && f.effect.ai_readability === 0)!;
  const [four, two, one] = [seo(4), seo(2), seo(1)];

  it('words three fixes to the next band, all open or two of them', () => {
    // 78 + 4 + 2 + 1 = 85, the A- floor: three fixes.
    expect(nextBandSentence(78, 'B', [four, two, one], () => true)).toBe(
      'Three fixes take it to A-; all are open now.',
    );
    expect(nextBandSentence(78, 'B', [four, two, one], (f) => f !== one)).toBe(
      'Three fixes take it to A-; two of them are open now.',
    );
  });

  it('words a single fix on Pro', () => {
    expect(nextBandSentence(83, 'B+', [two], () => false)).toBe(
      'One fix takes it to A-; it is on Pro.',
    );
  });

  it('calls structure sound from 70, uneven from 50, and weak below', () => {
    expect(structureWord(100)).toBe('Sound structure');
    expect(structureWord(70)).toBe('Sound structure');
    expect(structureWord(69.99)).toBe('Uneven structure');
    expect(structureWord(50)).toBe('Uneven structure');
    expect(structureWord(49.99)).toBe('Weak structure');
    expect(structureWord(0)).toBe('Weak structure');
  });

  it('says why the AI grade is withheld without naming the edge when no crawler met it', () => {
    const challenged = findCheck(fixture('challenged-site'), CHECKS.challengedFirstAudit);
    const edge =
      'The site’s edge blocks all automation, so only one of the four scored crawlers could be measured. Access is somewhere between 0 and 30 of 40.';
    expect(aiWithheldSummary(challenged, 1)).toBe(edge);
    const noEdge = structuredClone(challenged);
    for (const c of noEdge.crawlers.filter((x) => x.verdict === 'edge_blocks_automation')) {
      c.verdict = 'not_measured';
    }
    expect(aiWithheldSummary(noEdge, 1)).toBe(
      'Only one of the four scored crawlers could be measured. Access is somewhere between 0 and 30 of 40.',
    );
    expect(() => aiWithheldSummary(check, 4)).toThrow(/Not withheld/);
  });

  it('with every scored crawler measured, gives the grade’s own reason and not a count that explains nothing', () => {
    // The engine withholds for a part it could not measure too: all four crawlers read the site,
    // and the grade waits for pages read in a browser.
    const waiting = structuredClone(
      findCheck(fixture('challenged-site'), CHECKS.challengedFirstAudit),
    );
    for (const c of waiting.crawlers) {
      if (c.verdict === 'edge_blocks_automation') c.verdict = 'not_measured';
    }
    waiting.ai_readability!.withheld_reasons = ['readable_unmeasured'];
    waiting.ai_readability!.access_range = null;
    // No part holds a score here, so the sentence is the reason alone.
    for (const part of ['access', 'quotable', 'signals'] as const) {
      waiting.ai_readability!.components[part].score = null;
    }
    expect(aiWithheldSummary(waiting, 4)).toBe(
      'This audit did not measure the JavaScript comparison, which the AI readability grade needs.',
    );
    // Three of four measured is enough for Access (the engine scores it from two): the count is
    // still not why, and the grade's reason is given.
    expect(aiWithheldSummary(waiting, 3)).toBe(
      'This audit did not measure the JavaScript comparison, which the AI readability grade needs.',
    );
    // Of two reasons, the first.
    waiting.ai_readability!.withheld_reasons = ['quotable_unmeasured', 'readable_unmeasured'];
    expect(aiWithheldSummary(waiting, 3)).toBe(
      'This audit did not measure a content score or the JavaScript comparison, which the AI readability grade needs.',
    );
  });

  describe('a grade withheld for the count of crawlers, where the engine’s count and the contract’s part', () => {
    const WAITS = 'AI readability is graded once two scored crawlers can be measured.';
    /** The challenged site's first audit with the scored crawlers' verdicts and the reasons set. */
    function withheldFor(
      verdicts: Verdict[],
      reasons: WithheldReason[],
      unscoredAtEdge = false,
    ): { check: Check; measured: number } {
      const c = structuredClone(findCheck(fixture('challenged-site'), CHECKS.challengedFirstAudit));
      const scored = c.crawlers.filter((x) => x.scored);
      expect(scored).toHaveLength(4);
      scored.forEach((x, i) => (x.verdict = verdicts[i]!));
      for (const x of c.crawlers.filter((y) => !y.scored)) {
        x.verdict = unscoredAtEdge ? 'edge_blocks_automation' : 'not_measured';
      }
      c.ai_readability!.withheld_reasons = reasons;
      c.ai_readability!.access_range = null;
      for (const part of ['access', 'quotable', 'signals'] as const) {
        c.ai_readability!.components[part].score = null;
      }
      return { check: c, measured: scoredCrawlersMeasured(c.crawlers) };
    }
    const said = (v: Verdict[], r: WithheldReason[], unscoredAtEdge = false) => {
      const w = withheldFor(v, r, unscoredAtEdge);
      return [w.measured, aiWithheldSummary(w.check, w.measured)];
    };
    const COUNT: WithheldReason[] = ['too_few_crawlers_measured'];

    it('I4’s two is the engine’s', () => {
      expect(I4_MEASURED_CRAWLERS).toBe(MIN_MEASURED_CRAWLERS);
    });

    it('each crawler challenged or refused has a verdict and no score: the reason is said, not “four of the four”', () => {
      for (const verdict of ['challenged_ua', 'refused_unverified'] as const) {
        expect(said([verdict, verdict, verdict, verdict], COUNT)).toEqual([4, WAITS]);
      }
      // One served, two rate limited, one not measured: three by the contract, one by the engine.
      expect(said(['allowed', 'rate_limited', 'rate_limited', 'not_measured'], COUNT)).toEqual([
        3,
        WAITS,
      ]);
    });

    it('under two by the contract’s count too, the count is said, and “none” for none', () => {
      expect(said(['allowed', 'not_measured', 'not_measured', 'not_measured'], COUNT)).toEqual([
        1,
        'Only one of the four scored crawlers could be measured.',
      ]);
      expect(said(['not_measured', 'not_measured', 'not_measured', 'not_measured'], COUNT)).toEqual(
        [0, 'None of the four scored crawlers could be measured.'],
      );
      expect(
        said(
          [
            'edge_blocks_automation',
            'edge_blocks_automation',
            'edge_blocks_automation',
            'edge_blocks_automation',
          ],
          COUNT,
        ),
      ).toEqual([
        0,
        'The site’s edge blocks all automation, so none of the four scored crawlers could be measured.',
      ]);
    });

    it('the edge is named beside the count’s reason, and not in place of another reason', () => {
      expect(
        said(['challenged_ua', 'challenged_ua', 'edge_blocks_automation', 'not_measured'], COUNT),
      ).toEqual([2, `The site’s edge blocks all automation. ${WAITS}`]);
      const READ =
        'This audit did not measure the JavaScript comparison, which the AI readability grade needs.';
      // One scored crawler unmeasured at the edge, three served, and the grade waits for Readable.
      expect(
        said(['allowed', 'allowed', 'allowed', 'edge_blocks_automation'], ['readable_unmeasured']),
      ).toEqual([3, READ]);
      // Four served and an unscored crawler at the edge.
      expect(
        said(['allowed', 'allowed', 'allowed', 'allowed'], ['readable_unmeasured'], true),
      ).toEqual([4, READ]);
    });

    it('wherever the count stands among the reasons it is the one said', () => {
      expect(
        said(
          ['allowed', 'not_measured', 'not_measured', 'not_measured'],
          ['readable_unmeasured', 'too_few_crawlers_measured'],
        ),
      ).toEqual([
        1,
        'Only one of the four scored crawlers could be measured. This audit did not measure the JavaScript comparison, which the AI readability grade needs.',
      ]);
    });

    it('a withheld grade that names no reason is refused, as CheckSchema refuses it', () => {
      const w = withheldFor(['allowed', 'allowed', 'allowed', 'not_measured'], []);
      expect(() => aiWithheldSummary(w.check, w.measured)).toThrow(/names why/);
      expect(CheckSchema.safeParse(w.check).success).toBe(false);
    });
  });

  it('names each thin template, in the plural for more than one', () => {
    expect(thinSentence(check)).toBe('Product pages are empty without JavaScript.');
    const two = variant((c) => {
      for (const ua of SCORED_THIN) {
        crawler(c, ua).by_template.find((t) => t.template_key === '/blog/{slug}')!.verdict =
          'allowed_thin';
      }
    });
    expect(thinSentence(two)).toBe('Product pages and blog posts are empty without JavaScript.');
  });
});

describe('the vocabulary', () => {
  it('says "blocked" for robots.txt and user-agent rules and for no other verdict (FACTS I2)', () => {
    for (const verdict of VerdictSchema.options.filter((v) => !isAllowed(v))) {
      for (const cause of [null, ...AccessCauseSchema.options]) {
        const as = (ua: string) => ({
          ua,
          verdict,
          cause,
          evidence_class: 'simulated' as const,
          scored: true,
          group: 'ai_search' as const,
        });
        const clauses = [...keptOutClauses([as('A')]), ...keptOutClauses([as('A'), as('B')])];
        expect(clauses).toHaveLength(2);
        for (const clause of clauses) {
          expect(/\bblocked\b/.test(clause), `${verdict}/${cause}: ${clause}`).toBe(
            isBlocked(verdict),
          );
        }
      }
    }
  });
});

describe('a withheld AI readability grade says what was measured', () => {
  const withheld = (
    reasons: WithheldReason[],
    scores: { access?: number | null; quotable?: number | null; signals?: number | null },
  ) => {
    const c = structuredClone(findCheck(fixture('clean-site'), CHECKS.cleanFirstAudit)) as Check;
    const ai = c.ai_readability!;
    Object.assign(ai, { withheld: true, withheld_reasons: reasons, total: null, grade: null });
    ai.access_range = null;
    ai.components.readable.score = null;
    ai.components.access.score = scores.access ?? null;
    ai.components.quotable.score = scores.quotable ?? null;
    ai.components.signals.score = scores.signals ?? null;
    return c;
  };
  const NEEDS = 'which the AI readability grade needs.';

  it('names both parts the grade waits on, and what was tested', () => {
    const c = withheld(['readable_unmeasured', 'quotable_unmeasured'], { access: 40, signals: 5 });
    expect(aiWithheldSummary(c, 4)).toBe(
      `This audit did not measure the JavaScript comparison or a content score, ${NEEDS} It tested crawler access for all four scored crawlers and AI signals. Its access score rests on at least two of those crawlers.`,
    );
  });

  it('names one missing part alone', () => {
    const c = withheld(['readable_unmeasured'], { access: 40, quotable: 12, signals: 5 });
    expect(aiWithheldSummary(c, 4)).toBe(
      `This audit did not measure the JavaScript comparison, ${NEEDS} It tested crawler access for all four scored crawlers, content and AI signals. Its access score rests on at least two of those crawlers.`,
    );
  });

  it('says how many were tested from the verdicts, and claims no exact count for what Access rests on (D-10)', () => {
    const c = withheld(['readable_unmeasured', 'quotable_unmeasured'], { access: 40, signals: 5 });
    // A crawler may hold a verdict and not count toward Access, so what Access rests on stays
    // "at least two" where the grade stores no number; how many were tested is the verdict count.
    expect(aiWithheldSummary(c, 4)).toContain(
      'It tested crawler access for all four scored crawlers and AI signals. Its access score rests on at least two of those crawlers.',
    );
    expect(aiWithheldSummary(c, 3)).toContain(
      'It tested crawler access for three of the four scored crawlers and AI signals. Its access score rests on at least two of those crawlers.',
    );
    // None tested: the access clause is left out, never "none of the four" or "zero of".
    expect(aiWithheldSummary(c, 0)).toMatch(/ It tested AI signals\.$/);
    // Two scored, both tested: "both", not "all two".
    const two = structuredClone(c);
    let kept = 0;
    two.crawlers.forEach((x) => (x.scored = x.scored && kept++ < 2));
    expect(aiWithheldSummary(two, 2)).toMatch(
      /It tested crawler access for both scored crawlers and AI signals\.$/,
    );
    // A stored count over the tested one says nothing more: no "rests on three of those".
    const over = structuredClone(c);
    over.ai_readability!.scored_from_fewer_crawlers = 3;
    expect(aiWithheldSummary(over, 2)).toMatch(
      /It tested crawler access for two of the four scored crawlers and AI signals\.$/,
    );
    // One scored crawler, tested: "the one", not "all one".
    const one = structuredClone(c);
    one.crawlers.forEach((x, i) => (x.scored = i === one.crawlers.findIndex((y) => y.scored)));
    expect(aiWithheldSummary(one, 1)).toMatch(
      /It tested crawler access for the one scored crawler and AI signals\.$/,
    );
    // Two tested: "at least two of those crawlers" would be both, so nothing is added.
    expect(aiWithheldSummary(c, 2)).toMatch(
      /It tested crawler access for two of the four scored crawlers and AI signals\.$/,
    );
  });

  it('counts the crawlers Access was scored from, not the ones with a verdict', () => {
    const c = withheld(['readable_unmeasured', 'quotable_unmeasured'], { access: 40, signals: 5 });
    c.ai_readability!.scored_from_fewer_crawlers = 1;
    expect(aiWithheldSummary(c, 4)).toContain(
      'It tested crawler access for all four scored crawlers and AI signals. Its access score rests on one of those crawlers.',
    );
  });

  it('claims no test when no part has a score', () => {
    const c = withheld(['readable_unmeasured', 'quotable_unmeasured', 'signals_unmeasured'], {});
    const said = aiWithheldSummary(c, 4);
    expect(said).toContain('the schema.org and Content Signals checks');
    expect(said).not.toContain('It tested');
  });

  it('keeps the count first when too few crawlers were measured', () => {
    const c = withheld(['too_few_crawlers_measured', 'readable_unmeasured'], { signals: 5 });
    const said = aiWithheldSummary(c, 1);
    expect(said.startsWith('Only one of the four scored crawlers could be measured.')).toBe(true);
    expect(said).toContain(`This audit did not measure the JavaScript comparison, ${NEEDS}`);
    expect(said).toContain('It tested AI signals.');
  });

  it('does not offer a missing part to a site whose own robots.txt withholds the grade', () => {
    const c = withheld(['blocked_by_choice', 'readable_unmeasured', 'quotable_unmeasured'], {
      signals: 5,
    });
    const said = aiWithheldSummary(c, 4);
    expect(said).toBe(`${AI_WAITING.blocked_by_choice}.`);
  });

  it('holds no promise a minted report would freeze', () => {
    const c = withheld(['readable_unmeasured', 'quotable_unmeasured'], { access: 40, signals: 5 });
    expect(aiWithheldSummary(c, 4)).not.toMatch(/coming|soon|yet/i);
    expect(Object.values(AI_WAITING).join(' ')).not.toMatch(/coming/i);
  });
});
