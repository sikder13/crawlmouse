import { MIN_GRADEABLE_PAGES } from '@crawlmouse/types';
import { describe, it, expect } from 'vitest';
import type { CoverageAccounting, RefusalTrigger } from '@crawlmouse/types';
import {
  excludedLabel,
  NO_GRADE_EXPLANATION,
  NO_GRADE_LABEL,
  noGradeShareText,
  refusalCopy,
  type RefusalCopyInput,
} from './refusal-copy';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a Stage 4 — THE FIVE APPROVED REFUSAL BODIES, at the ONE seam.
//
// These could not be wired until `audits.refusal` persisted (applied 2026-08-04): selecting between
// the bodies requires the trigger list, and the triggers were deliberately NOT re-derived from
// confidence / fetched_ok_count / partial, because that would be a second hand-synchronised copy of
// `decideRefusal` — the third instance of the defect class the sweep item now tracks.
//
// TWO RULES GOVERN EVERY BODY, and both are asserted on all five rather than spot-checked:
//   1. A refusal is NEVER styled as an F, and never described as one.
//   2. NO next step is EVER a Pro upsell. None of the triggers is solved by a bigger crawl budget,
//      so an upsell here would be a lie — and it is the most tempting lie in the product.
// ─────────────────────────────────────────────────────────────────────────────

const coverage = (over: Partial<CoverageAccounting> = {}): CoverageAccounting => ({
  fetched: 79,
  gradeable: 79,
  excluded: [],
  sitemapDeclared: null,
  sitemapRobotsExcluded: null,
  estimatedTotal: null,
  estimateSource: 'none',
  coverageRatio: null,
  ...over,
});

const input = (triggers: RefusalTrigger[], over: Partial<RefusalCopyInput> = {}): RefusalCopyInput => ({
  triggers,
  coverage: coverage(),
  crawl: { fetchedOk: 79, blocked: 0, discovered: 79, attempted: 79 },
  siteUrl: 'https://example.com/',
  ...over,
});

const ALL_FIVE: RefusalCopyInput[] = [
  input(['site_too_small_to_measure'], { coverage: coverage({ fetched: 4, gradeable: 4 }), crawl: { fetchedOk: 4, blocked: 0, discovered: 4, attempted: 4 } }),
  input(['too_few_gradeable_pages'], { coverage: coverage({ fetched: 3, gradeable: 3, estimatedTotal: 821, estimateSource: 'sitemap' }), crawl: { fetchedOk: 3, blocked: 0, discovered: 821, attempted: 821 } }),
  input(['no_observed_links']),
  input(['too_few_gradeable_pages'], { coverage: coverage({ fetched: 1, gradeable: 1, sitemapDeclared: 821, sitemapRobotsExcluded: 0 }) }),
  input(['nothing_read'], { coverage: coverage({ fetched: 50, gradeable: 0 }), crawl: { fetchedOk: 0, blocked: 50, discovered: 50, attempted: 50 } }),
];

describe('the two rules that govern EVERY body', () => {
  it('never describes a refusal as a failing grade', () => {
    for (const i of ALL_FIVE) {
      const c = refusalCopy(i);
      const all = [c.headline, ...c.body, c.next ?? ''].join(' ').toLowerCase();
      expect(all).not.toContain('failing');
      expect(all).not.toContain('failed');
      expect(all).not.toMatch(/\bf grade\b/);
      expect(all).not.toMatch(/\bscored\b/);
    }
  });

  it('NEVER offers a Pro upsell as the next step', () => {
    // The most tempting lie in the product: none of these triggers is solved by a bigger crawl budget,
    // so "upgrade for a deeper crawl" would be selling a fix that cannot work.
    for (const i of ALL_FIVE) {
      const c = refusalCopy(i);
      const all = [c.headline, ...c.body, c.next ?? ''].join(' ').toLowerCase();
      // WORD BOUNDARIES, not substrings: "reproduces" in the nothing_read body contains "pro" and is
      // not an upsell. A substring check here would have forced the copy to avoid a correct word.
      for (const banned of ['pro', 'upgrade', 'plan', 'pricing', 'paid', 'subscribe', 'unlock']) {
        expect(all).not.toMatch(new RegExp(`\\b${banned}\\b`));
      }
    }
  });

  it('always produces a headline and at least one body paragraph', () => {
    for (const i of ALL_FIVE) {
      const c = refusalCopy(i);
      expect(c.headline.length).toBeGreaterThan(0);
      expect(c.body.length).toBeGreaterThan(0);
    }
  });
});

describe('(a) site_too_small_to_measure — the whole site, read completely', () => {
  const c = refusalCopy(input(['site_too_small_to_measure'], {
    coverage: coverage({ fetched: 4, gradeable: 4 }),
    crawl: { fetchedOk: 4, blocked: 0, discovered: 4, attempted: 4 },
  }));

  it('says the site is too small, and that we read ALL of it', () => {
    expect(c.headline).toBe('Your site is too small for an internal-linking grade');
    const body = c.body.join(' ');
    expect(body).toContain('We crawled all 4 pages');
    // The load-bearing clause: this is NOT a partial read, and saying so is what stops the copy
    // accusing a legitimate four-page brochure of blocking us.
    expect(body).toContain('that’s the whole site, not a partial read');
  });

  it('states the floor as a NUMBER and as OUR rule — never a hedge', () => {
    // Owner revision. "About five" inside the honesty gate reads as uncertainty about our OWN
    // threshold, which is the one thing we are entitled to be certain about.
    const body = c.body.join(' ');
    // Derived from the gate's constant on BOTH sides, so re-tuning the floor moves the sentence and
    // the assertion together instead of letting them agree on a stale number (gate 4 / R1-NB3).
    expect(body).toContain(`Below ${MIN_GRADEABLE_PAGES} pages we don’t publish a letter`);
    // ...and the floor really is the one the gate applies, not a literal that happens to match.
    expect(MIN_GRADEABLE_PAGES).toBe(5);
    expect(body).not.toContain('about five');
    expect(body).not.toContain('roughly');
    expect(body).not.toMatch(/~\s*5/);
  });

  it('offers a next step that is true — more pages, not a bigger crawl', () => {
    expect(c.next?.toLowerCase()).toContain('as you add pages');
  });
});

describe('(b) too_few_gradeable_pages — a larger site we barely reached', () => {
  const c = refusalCopy(input(['too_few_gradeable_pages'], {
    coverage: coverage({ fetched: 3, gradeable: 3, estimatedTotal: 821, estimateSource: 'sitemap' }),
    crawl: { fetchedOk: 3, blocked: 0, discovered: 821, attempted: 821 },
  }));

  it('says WE fell short, not that the site is small', () => {
    expect(c.headline).toBe('We didn’t read enough of your site to grade it');
    // Updated when the sentence was corrected: it previously read "We reached 3 of an estimated 821
    // pages", where the 3 was the GRADEABLE count — inviting the reader to conclude the crawl fetched
    // three pages. Fetched, gradeable and estimated are now each named as themselves.
    expect(c.body.join(' ')).toContain('We fetched 3 pages of an estimated 821');
    expect(c.body.join(' ')).toContain('only 3 were content pages we can grade');
  });

  it('never claims the site is too small — that is the OTHER trigger and would be false here', () => {
    expect(c.body.join(' ').toLowerCase()).not.toContain('too small');
  });
});

describe('(c) no_observed_links — the finding leads', () => {
  const c = refusalCopy(input(['no_observed_links'], { coverage: coverage({ gradeable: 79 }) }));

  it('is precise about WHICH pages: links between the pages we GRADED', () => {
    // Owner revision. We observed no links INTO the graded population; excluded pages may well carry
    // links. This is the copy that proves we say only what we measured.
    expect(c.headline).toBe('We didn’t find any links between the pages we graded');
    expect(c.body.join(' ')).toContain('no internal links connecting the pages in the graded set');
    expect(c.body.join(' ')).toContain('Across 79 pages');
  });

  it('includes the archive/tag clause ONLY when pages were actually excluded that way', () => {
    // Owner revision, with the honesty condition attached: the clause is true only when such pages
    // exist. Asserting it on a site with no archive exclusions would invent a reason.
    const withArchives = refusalCopy(input(['no_observed_links'], {
      coverage: coverage({ gradeable: 79, excluded: [{ kind: 'archive', count: 412 }] }),
    }));
    expect(withArchives.body.join(' ')).toContain('Links pointing at archive or tag pages don’t count');
    // …and NOT when nothing was excluded that way.
    expect(c.body.join(' ')).not.toContain('archive or tag pages');
  });

  it('carries the AI-crawler consequence — what we couldn’t see, they can’t either', () => {
    expect(c.body.join(' ')).toContain('AI crawlers and assistants read the same static HTML');
  });

  it('explains why no grade follows, in terms of the measurement', () => {
    expect(c.body.join(' ')).toContain('every internal-linking measurement needs at least one internal link');
  });
});

describe('(d) the sitemap-delta body is CUT — the delta can never become a headline', () => {
  // D4 is cut from 5.1a: the count was a function of our own page cap. Body (d) made that number the
  // HEADLINE of a refusal, which was the worst place for it — on a refused audit the incomplete-crawl
  // caveat is deliberately withheld, so the number led with its only qualifier removed by design.
  //
  // The precedence is now nothing_read -> below-floor (a/b) -> no_observed_links. These pin that a
  // coverage payload from a PRE-CUT row, which still carries the old field, cannot resurrect it.
  const legacyCoverage = {
    fetched: 1, gradeable: 1, excluded: [], sitemapDeclared: 821,
    sitemapRobotsExcluded: 0, estimatedTotal: 821, estimateSource: 'sitemap' as const, coverageRatio: 0.001,
    // The field the engine no longer emits, as an old row would still carry it.
    sitemapUnreached: 820,
  } as never;

  it('falls through to the below-floor body instead of leading with a sitemap number', () => {
    const c = refusalCopy({ triggers: ['too_few_gradeable_pages'], coverage: legacyCoverage });
    expect(c.headline).not.toContain('821');
    expect(c.headline).not.toContain('820');
    expect(c.headline).not.toContain('sitemap');
  });

  it('never emits a reachability claim anywhere in the copy, from any trigger', () => {
    for (const trigger of ['site_too_small_to_measure', 'too_few_gradeable_pages', 'no_observed_links', 'nothing_read'] as const) {
      const c = refusalCopy({ triggers: [trigger], coverage: legacyCoverage });
      const all = [c.headline, ...c.body, c.next ?? ''].join(' ');
      // The claim, not the number. `821` legitimately appears as `estimatedTotal` in the below-floor
      // body ("we reached 1 of an estimated 821 pages") — that is a disclosure about OUR coverage,
      // which is exactly the honest form. What must never appear is a statement about the SITE's
      // link structure derived from it.
      expect(all, `${trigger} leaked a reachability claim`).not.toMatch(/reached by following links/i);
      expect(all, `${trigger} leaked a reachability claim`).not.toMatch(/nothing links to them/i);
      expect(all, `${trigger} leaked a reachability claim`).not.toMatch(/reachable by clicking/i);
      expect(all, `${trigger} promoted the delta`).not.toContain('in your sitemap can');
    }
  });

  it('still produces a real body — the cut removes a claim, not the screen', () => {
    // Anti-vacuity: if refusalCopy returned nothing the assertions above would all pass.
    const c = refusalCopy({ triggers: ['no_observed_links'], coverage: legacyCoverage });
    expect(c.headline.length).toBeGreaterThan(10);
    expect(c.body.length).toBeGreaterThan(0);
  });
});

describe('(e) nothing_read — the server returned nothing', () => {
  const c = refusalCopy(input(['nothing_read'], {
    coverage: coverage({ fetched: 50, gradeable: 0 }),
    crawl: { fetchedOk: 0, blocked: 50, discovered: 50, attempted: 50 },
    siteUrl: 'https://yoursite.com/',
  }));

  it('states the counts plainly', () => {
    expect(c.headline).toBe('Your server didn’t return a single page to us');
    expect(c.body.join(' ')).toContain('50 requests, 50 refused');
  });

  it('gives a REPRODUCING command, not advice', () => {
    // A check the owner can run themselves beats a diagnosis they have to take on faith.
    const body = c.body.join(' ');
    expect(body).toContain('curl -A "CrawlmouseBot/1.0" https://yoursite.com');
    expect(body).toContain('403 or 429');
  });

  it('makes the AI-crawler connection — the same rule usually catches them', () => {
    // Owner revision. This is the sentence that turns a blocked crawl from our problem into the
    // owner's information.
    const body = c.body.join(' ');
    expect(body).toContain('A 403/429 to us likely means AI crawlers are blocked too');
    expect(body).toContain('GPTBot');
    expect(body).toContain('ClaudeBot');
  });
});

describe('the fallback — a pre-migration audit has a null verdict and no triggers', () => {
  it('falls back to the generic explanation rather than inventing a reason', () => {
    // Existing rows were NOT backfilled: `grade` is null and `refusal` is null. Guessing a trigger for
    // them would be exactly the fabrication this module exists to prevent.
    const c = refusalCopy({ triggers: [], coverage: null, crawl: null, siteUrl: null });
    expect(c.headline).toBe('We couldn’t grade this site');
    expect(c.body).toEqual([NO_GRADE_EXPLANATION]);
    expect(c.next).toBeNull();
  });

  it('omits a count it does not have rather than printing a zero', () => {
    // "We crawled all 0 pages" is worse than saying nothing.
    const c = refusalCopy({ triggers: ['site_too_small_to_measure'], coverage: null, crawl: null, siteUrl: null });
    expect(c.body.join(' ')).not.toMatch(/\ball 0 pages\b/);
    expect(c.body.join(' ')).not.toContain('undefined');
    expect(c.body.join(' ')).not.toContain('null');
  });
});

describe('precedence when several triggers fire at once', () => {
  it('nothing_read outranks everything — if we read nothing, the rest is moot', () => {
    const c = refusalCopy(input(['too_few_gradeable_pages', 'nothing_read', 'no_observed_links'], {
      coverage: coverage({ fetched: 50, gradeable: 0 }),
      crawl: { fetchedOk: 0, blocked: 50, discovered: 50, attempted: 50 },
    }));
    expect(c.headline).toBe('Your server didn’t return a single page to us');
  });

  it('the below-floor reason outranks no_observed_links — at 3 pages, "no links" is a consequence', () => {
    // On a 3-page site the absent edges are a property of the tiny sample, not an independent
    // finding, so leading with them would misattribute the cause.
    const c = refusalCopy(input(['site_too_small_to_measure', 'no_observed_links'], {
      coverage: coverage({ fetched: 3, gradeable: 3 }),
      crawl: { fetchedOk: 3, blocked: 0, discovered: 3, attempted: 3 },
    }));
    expect(c.headline).toBe('Your site is too small for an internal-linking grade');
  });
});

describe('the shared label + share text still hold', () => {
  it('keeps the grade-slot label a word, never a glyph', () => {
    expect(NO_GRADE_LABEL).not.toContain('—');
    expect(NO_GRADE_LABEL.toLowerCase()).toContain('grade');
  });

  it('keeps the share text out of the boastful frame', () => {
    expect(noGradeShareText('ex.com')).not.toContain('I scored');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NO COPY MAY DERIVE A NUMBER FROM AN INPUT THAT IS NOT THAT NUMBER.
//
// Two live defects of this exact shape were found by RENDERING the refused states and reading them,
// not by any failing test:
//   1. `nothing_read` printed "N requests, N refused" from a single value, and fell back to
//      `coverage.fetched` — successful fetches, which is 0 for this trigger — so the primary screen
//      rendered "0 requests, 0 refused" directly beneath a headline saying the server refused us.
//   2. `too_few_gradeable_pages` printed "We reached 2 of an estimated 900 pages", where 2 was the
//      GRADEABLE count. The crawl fetched 40 and excluded 38 archives. Not false; it invites a false
//      count, which is the same defect one step removed.
// ─────────────────────────────────────────────────────────────────────────────
describe('refusal copy never derives a number from a different number', () => {
  it('nothing_read: prints ATTEMPTED and REFUSED as two distinct measurements', () => {
    const c = refusalCopy({
      triggers: ['nothing_read'],
      crawl: { fetchedOk: 0, blocked: 47, discovered: 61, attempted: 61 },
    });
    expect(c.body[0]).toContain('61 requests, 47 refused');
    // The two figures must not collapse into one another.
    expect(c.body[0]).not.toContain('47 requests, 47 refused');
    expect(c.body[0]).not.toContain('61 requests, 61 refused');
  });

  it('nothing_read: OMITS the count sentence when either measurement is missing', () => {
    // Null means NOT INSTRUMENTED, which is not zero. Omitting is honest; substituting is not.
    for (const crawl of [
      { fetchedOk: 0, blocked: null, discovered: 61, attempted: 61 },
      { fetchedOk: 0, blocked: 47, discovered: null, attempted: null },
      null,
    ]) {
      const c = refusalCopy({ triggers: ['nothing_read'], crawl });
      expect(c.body[0]).toBe('Nothing was read, so there is nothing to grade.');
      expect(c.body.join(' ')).not.toMatch(/\d+\s+requests?/);
    }
  });

  it('nothing_read: never falls back to a count of SUCCESSFUL fetches', () => {
    // The old fallback was `coverage.fetched`. On this trigger that is 0, which produced the
    // self-contradicting "0 requests, 0 refused".
    const c = refusalCopy({
      triggers: ['nothing_read'],
      coverage: { fetched: 0, gradeable: 0 } as never,
      crawl: { fetchedOk: 0, blocked: null, discovered: null, attempted: null },
    });
    expect(c.body[0]).not.toContain('0 requests');
  });

  it('too_few_gradeable_pages: names fetched, gradeable and estimated SEPARATELY', () => {
    const c = refusalCopy({
      triggers: ['too_few_gradeable_pages'],
      coverage: { fetched: 40, gradeable: 2, estimatedTotal: 900 } as never,
    });
    expect(c.body[0]).toContain('40');
    expect(c.body[0]).toContain('900');
    expect(c.body[0]).toContain('2');
    // The sentence that invited the false count must not return.
    expect(c.body[0]).not.toContain('We reached 2 of an estimated 900');
  });

  it('too_few_gradeable_pages: degrades honestly as each number drops out', () => {
    const noTotal = refusalCopy({ triggers: ['too_few_gradeable_pages'], coverage: { fetched: 40, gradeable: 2 } as never });
    expect(noTotal.body[0]).toContain('40');
    expect(noTotal.body[0]).not.toMatch(/estimated/);
    const nothing = refusalCopy({ triggers: ['too_few_gradeable_pages'] });
    expect(nothing.body[0]).not.toMatch(/\d/);
  });
});

describe('(a) names fetched and gradeable separately — R3 gate-3 blocker', () => {
  // MEASURED, not theorised. A real 11-page fixture through the shipped engine yields
  // fetched 11 / gradeable 3 (2 posts + homepage; 6 archive, 2 pagination excluded). The copy used
  // to print "We crawled all 3 pages — that's the whole site". We crawled 11. The site has 11.
  it('does not report the GRADEABLE count as the crawled count', () => {
    const c = refusalCopy(input(['site_too_small_to_measure'], {
      coverage: coverage({ fetched: 11, gradeable: 3 }),
      crawl: { fetchedOk: 11, blocked: 0, discovered: 11, attempted: 11 },
    }));
    const body = c.body.join(' ');
    expect(body).not.toContain('We crawled all 3 pages');
    expect(body).toContain('We crawled all 11 pages');
    expect(body).toContain('3 of them are content pages we can grade');
  });

  it('keeps the simple sentence when every fetched page is gradeable', () => {
    const c = refusalCopy(input(['site_too_small_to_measure'], {
      coverage: coverage({ fetched: 4, gradeable: 4 }),
      crawl: { fetchedOk: 4, blocked: 0, discovered: 4, attempted: 4 },
    }));
    expect(c.body.join(' ')).toContain('We crawled all 4 pages — that’s the whole site');
    expect(c.body.join(' ')).not.toContain('of them are content pages');
  });

  it('singular agreement at one gradeable page', () => {
    const c = refusalCopy(input(['site_too_small_to_measure'], {
      coverage: coverage({ fetched: 9, gradeable: 1 }),
      crawl: { fetchedOk: 9, blocked: 0, discovered: 9, attempted: 9 },
    }));
    expect(c.body.join(' ')).toContain('1 of them is a content page we can grade');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE 4 / B2 — `discovered` IS NOT `attempted`, and the sentence names attempted.
//
// `refusalCopy` read `crawl.discovered` and printed it as the request count. Proven end to end
// through the shipped engine on a host serving 404 + full navigation (404 does not throw, so the
// request handler runs and records the page's links): attempted 3, discovered 8 — and the honesty
// screen rendered "8 requests, 0 refused" directly under "Your server didn't return a single page
// to us". We made three requests and none was refused; both halves of the sentence were false, on
// the one trigger whose entire purpose is telling the owner their host is blocking us.
//
// `discovered` = fetched ∪ link targets. It counts URLs we deliberately never requested —
// robots-disallowed, trap-capped, cap-excluded, budget-stranded — so it is not merely a different
// number, it is a number about a different SET.
// ─────────────────────────────────────────────────────────────────────────────
describe('B2 — the request count comes from `attempted`, never from `discovered`', () => {
  it('prints the ATTEMPTED count, on the exact shape the engine produced', () => {
    const c = refusalCopy({
      triggers: ['nothing_read'],
      crawl: { fetchedOk: 0, blocked: 0, discovered: 8, attempted: 3 },
    });
    expect(c.body[0]).toBe('3 requests, 0 refused. Nothing was read, so there is nothing to grade.');
    // The discovered count must appear NOWHERE in the copy — not as requests, not as anything.
    expect(c.body.join(' ')).not.toContain('8 requests');
  });

  it('omits the sentence when `attempted` is unknown, rather than reaching for `discovered`', () => {
    // This is the LIVE shape: `attempted` is computed by the engine and no column persists it, so
    // every production read passes null. Omitting is the module's own rule; substituting the nearest
    // available number is the defect this describe block exists for.
    const c = refusalCopy({
      triggers: ['nothing_read'],
      crawl: { fetchedOk: 0, blocked: 0, discovered: 8, attempted: null },
    });
    expect(c.body[0]).toBe('Nothing was read, so there is nothing to grade.');
    expect(c.body.join(' ')).not.toMatch(/\d+\s+requests?/);
  });

  it('still says what it CAN — the how-to-check and the AI-crawler connection survive the omission', () => {
    // Losing the counts must not quietly gut body (e). The owner's third revision is the part that
    // turns a blocked crawl into information the owner can act on.
    const c = refusalCopy({
      triggers: ['nothing_read'],
      crawl: { fetchedOk: 0, blocked: 0, discovered: 8, attempted: null },
    });
    const all = c.body.join(' ');
    expect(all).toContain('403');
    expect(all).toContain('GPTBot');
    expect(all).toContain('ClaudeBot');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE COPY IS RENDERED FROM THE DATA — it cannot name a kind that is not there.
//
// The first version free-wrote "Tag, category, archive and pagination pages are how a site is
// organised…" on every refusal of this kind. Measured against the five production rows it
// reclassifies, FOUR excluded only `thin` pages. These tests exist so that sentence cannot come back:
// each one drives a REAL production composition and asserts the copy says what that row says.
// ─────────────────────────────────────────────────────────────────────────────
describe('the exclusion copy is derived from coverage.excluded, never written about it', () => {
  const cov = (over: Partial<CoverageAccounting>): CoverageAccounting => ({
    fetched: 0, gradeable: 0, excluded: [], sitemapDeclared: null, sitemapRobotsExcluded: null,
    estimatedTotal: null, estimateSource: 'none', coverageRatio: null, ...over,
  } as CoverageAccounting);
  const render = (coverage: CoverageAccounting) =>
    refusalCopy({ triggers: ['too_few_gradeable_after_exclusion'], coverage });

  // The five rows this trigger reclassifies, exactly as production recorded them on 2026-08-08.
  const LIVE = {
    randomcircles: cov({ fetched: 5, gradeable: 1, excluded: [{ kind: 'thin', count: 4 }] }),
    chappie: cov({ fetched: 8, gradeable: 1, excluded: [{ kind: 'thin', count: 6 }, { kind: 'auth', count: 1 }] }),
    alynthe: cov({ fetched: 9, gradeable: 1, excluded: [{ kind: 'thin', count: 8 }] }),
    provion: cov({ fetched: 79, gradeable: 3, excluded: [{ kind: 'thin', count: 76 }] }),
    quotes: cov({ fetched: 214, gradeable: 1, excluded: [{ kind: 'pagination', count: 152 }, { kind: 'archive', count: 60 }, { kind: 'auth', count: 1 }] }),
  };

  it('a THIN-ONLY site never mentions tags, archives or pagination', () => {
    // Four of the five real rows are this shape. The free-written paragraph asserted archives on all
    // of them — an invented cause inside the honesty gate.
    for (const [name, coverage] of [['randomcircles', LIVE.randomcircles], ['alynthe', LIVE.alynthe], ['provion', LIVE.provion]] as const) {
      const all = [render(coverage).headline, ...render(coverage).body].join(' ').toLowerCase();
      expect(all, `${name} named a kind it did not have`).not.toContain('tag');
      expect(all, name).not.toContain('archive');
      expect(all, name).not.toContain('pagination');
      expect(all, name).toContain('too little text to grade');
    }
  });

  it('names ONLY kinds present, on every one of the five live rows', () => {
    const KINDWORDS: Record<string, string> = {
      thin: 'too little text', archive: 'archive', pagination: 'pagination',
      auth: 'login or account', search: 'search-result', feed: 'feed',
      duplicate: 'near-duplicate', status: 'status permalink', utility: 'cart, checkout',
    };
    for (const [name, coverage] of Object.entries(LIVE)) {
      const body = render(coverage).body.join(' ').toLowerCase();
      const present = new Set(coverage.excluded.map((e) => e.kind));
      for (const [kind, word] of Object.entries(KINDWORDS)) {
        if (!present.has(kind as never)) {
          expect(body, `${name} named absent kind ${kind}`).not.toContain(word);
        } else {
          // THE POSITIVE HALF. Without it this test survived `if (false && has(...))`: the branch fell
          // through to generic copy, no kind word appeared at all, and every `not.toContain` passed —
          // green while asserting nothing. An absence-only test cannot tell "named correctly" from
          // "said nothing".
          expect(body, `${name} failed to name its OWN kind ${kind}`).toContain(word);
        }
      }
    }
  });

  it('SINGULAR counts read singular — "1 login or account page", not "pages"', () => {
    // Shipped as "1 login or account pages" on quotes.toscrape, and was quoted verbatim into the
    // evidence file without anyone noticing.
    const body = render(LIVE.quotes).body.join(' ');
    expect(body).toContain('1 login or account page');
    expect(body).not.toContain('1 login or account pages');
    // and the plural still reads plural
    expect(body).toContain('152 pagination pages');
  });

  it('never asserts a quantifier the numbers contradict', () => {
    // gradeable 4 of 5 content-bearing: one page excluded. "most of them" was false here and sat one
    // sentence above "That left 4 content pages".
    const body = render(cov({ fetched: 5, gradeable: 4, excluded: [{ kind: 'archive', count: 1 }] })).body.join(' ');
    expect(body.toLowerCase()).not.toContain('most of them');
    expect(body).toContain('1 tag or category archive');
    expect(body).toContain('That left 4 content pages');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE WEDGE — every printed number is an identity over the persisted coverage fields.
//
// `coverage.fetched` counts every URL fetched at any status, including off-host; `coverage.excluded`
// is tallied only over same-host-200 pages. Feeding the gate the first made them irreconcilable.
// freepltn.com carries the divergent shape in production today: fetched 219, gradeable 122,
// Σexcluded 73 — 24 pages fetched that never entered the graded population at all.
// ─────────────────────────────────────────────────────────────────────────────
describe('printed numbers reconcile with the persisted coverage', () => {
  const cov = (over: Partial<CoverageAccounting>): CoverageAccounting => ({
    fetched: 0, gradeable: 0, excluded: [], sitemapDeclared: null, sitemapRobotsExcluded: null,
    estimatedTotal: null, estimateSource: 'none', coverageRatio: null, ...over,
  } as CoverageAccounting);

  it('unaccounted fetches are named as FETCH OUTCOMES, never as exclusions', () => {
    // The freepltn wedge, scaled below the floor so the trigger fires: 24 fetched pages that are not
    // exclusions must not be folded into the exclusion sentence.
    const body = refusalCopy({
      triggers: ['too_few_gradeable_after_exclusion'],
      coverage: cov({ fetched: 30, gradeable: 2, excluded: [{ kind: 'thin', count: 4 }] }),
    }).body.join(' ');
    // content-bearing = 2 + 4 = 6; unaccounted = 30 - 6 = 24
    expect(body).toContain('Of the 6 pages we read on this site');
    expect(body).toContain('4 pages with too little text to grade');
    expect(body).toContain('We also fetched 24 pages that didn’t return a page we could read');
    // The exclusion sentence must NOT claim the 30.
    expect(body).not.toContain('Of the 30');
  });

  it('says nothing about fetch outcomes when there are none to name', () => {
    const body = refusalCopy({
      triggers: ['too_few_gradeable_after_exclusion'],
      coverage: cov({ fetched: 214, gradeable: 1, excluded: [{ kind: 'pagination', count: 213 }] }),
    }).body.join(' ');
    expect(body).not.toContain('We also fetched');
    // The positive half: prove we are looking at the branch under test, not at generic fallback copy
    // that trivially says nothing about fetch outcomes either.
    expect(body).toContain('Of the 214 pages we read on this site, 213 pagination pages');
  });

  it('PROPERTY: the narrated population and shortfall are identities over the persisted fields', () => {
    // Swept rather than spot-checked. For every shape the trigger can take, the copy must print
    // `gradeable + Σexcluded` as the population it read, `Σexcluded` as the shortfall it narrates,
    // and `fetched - (gradeable + Σexcluded)` as fetch outcomes — no other arithmetic.
    //
    // ⚠ THE KIND-COUNT AXIS IS SWEPT SEPARATELY, BELOW. This loop varies gradeable, exclusion total
    // and unaccounted fetches, but every case has 1-2 kinds, so it could never reach the `slice(0, 3)`
    // bound — which is exactly the attribute that rule keys on.
    for (const gradeable of [0, 1, 2, 4]) {
      for (const excl of [[{ kind: 'thin' as const, count: 5 }], [{ kind: 'archive' as const, count: 3 }, { kind: 'auth' as const, count: 1 }], [{ kind: 'pagination' as const, count: 213 }]]) {
        for (const extra of [0, 1, 24]) {
          const total = excl.reduce((n, e) => n + e.count, 0);
          const contentBearing = gradeable + total;
          const coverage = cov({ fetched: contentBearing + extra, gradeable, excluded: excl });
          const body = refusalCopy({ triggers: ['too_few_gradeable_after_exclusion'], coverage }).body.join(' ');
          const label = `g=${gradeable} excl=${total} extra=${extra}`;

          expect(body, `${label}: population`).toContain(`Of the ${contentBearing} page`);
          expect(body, `${label}: remainder`).toContain(`That left ${gradeable} content page`);
          // Pin the count TO ITS LABEL, not to a bare digit: `toContain('4 ')` was satisfied by
          // "That left 4 content pages" and so asserted almost nothing.
          for (const e of excl) {
            expect(body, `${label}: kind ${e.kind}`).toContain(`${e.count} ${excludedLabel(e.kind, e.count, (n) => (n === 1 ? 'page' : 'pages'))}`);
          }
          if (extra > 0) expect(body, `${label}: fetch outcomes`).toContain(`We also fetched ${extra} page`);
          else expect(body, `${label}: no phantom fetch sentence`).not.toContain('We also fetched');
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE KIND-COUNT AXIS — the attribute `slice(0, 3)` actually keys on.
//
// §10's matcher-class rule, applied to a display bound rather than to data: a sweep over exclusion
// TOTALS can never falsify a rule that triggers on the NUMBER OF KINDS, and it did not. A reviewer
// rendered the consequence at 5 kinds: "Of the 60 pages we read on this site, 39 …, 9 …, 5 …, and 2
// other kinds" — 39 + 9 + 5 = 53, seven pages unaccounted, with "2" sitting inside a list of page
// counts where it reads as two pages. The evidence file called every printed number an identity over
// the persisted fields; that held only at or below the bound.
//
// Live-reachable, not hypothetical: rewardguru.in carries 4 kinds in production today.
// ─────────────────────────────────────────────────────────────────────────────
describe('the composition reconciles at every kind count, and discloses what it withholds', () => {
  const cov = (over: Partial<CoverageAccounting>): CoverageAccounting =>
    ({
      fetched: 0,
      gradeable: 0,
      excluded: [],
      sitemapDeclared: null,
      sitemapRobotsExcluded: null,
      estimatedTotal: null,
      estimateSource: 'none',
      coverageRatio: null,
      ...over,
    }) as CoverageAccounting;

  // Every excludable kind, so the axis runs to its real maximum rather than to the 4 seen in the wild.
  const ALL_KINDS = ['thin', 'archive', 'pagination', 'auth', 'search', 'feed', 'duplicate', 'status', 'utility'] as const;

  /**
   * Sum every PAGE count the copy prints inside the exclusion clause — the reader's own arithmetic.
   *
   * The `across N other kinds` figure counts KINDS, not pages, and is deliberately excluded here. That
   * it needs excluding at all is the point of the fix: the previous copy printed that number with no
   * unit beside it, in a list of page counts, so a reader summing the sentence got the wrong total and
   * had no way to know. It now carries its own noun on both sides ("7 pages across 2 other kinds"), so
   * the page counts sum and the kind count is unambiguously not one of them.
   */
  function narratedExclusionTotal(sentence: string): number {
    const clause = sentence
      .slice(sentence.indexOf('site,') + 'site,'.length)
      .replace(/across \d+ other kinds?/, 'across other kinds');
    return (clause.match(/\d+/g) ?? []).map(Number).reduce((a, b) => a + b, 0);
  }

  it('PROPERTY: printed counts sum to the printed population, for 1…9 kinds', () => {
    for (let n = 1; n <= ALL_KINDS.length; n++) {
      // Distinct descending counts, so ordering is unambiguous and no two kinds share a number.
      const excluded = ALL_KINDS.slice(0, n).map((kind, i) => ({ kind, count: (n - i) * 3 }));
      const total = excluded.reduce((acc, e) => acc + e.count, 0);
      const gradeable = 1;
      const body = refusalCopy({
        triggers: ['too_few_gradeable_after_exclusion'],
        coverage: cov({ fetched: gradeable + total, gradeable, excluded: excluded as never }),
      }).body;
      const first = body.find((b) => b.startsWith('Of the '))!;
      const label = `${n} kinds`;

      expect(first, `${label}: population`).toContain(`Of the ${gradeable + total} pages we read on this site,`);
      // THE READER'S SUM, computed from the rendered string rather than from the input. This is the
      // assertion the old bound failed.
      expect(narratedExclusionTotal(first), `${label}: printed counts must sum to ${total}`).toBe(total);
      expect(body.join(' '), `${label}: remainder`).toContain(`That left ${gradeable} content page`);
    }
  });

  it('above the bound it names the withheld PAGES, not only the kind count', () => {
    // The reviewer's exact 5-kind shape, reproduced.
    const excluded = [
      { kind: 'thin', count: 39 },
      { kind: 'archive', count: 9 },
      { kind: 'auth', count: 5 },
      { kind: 'search', count: 4 },
      { kind: 'feed', count: 3 },
    ];
    const first = refusalCopy({
      triggers: ['too_few_gradeable_after_exclusion'],
      coverage: cov({ fetched: 60, gradeable: 0, excluded: excluded as never }),
    }).body.find((b) => b.startsWith('Of the '))!;

    expect(first).toContain('Of the 60 pages we read on this site,');
    expect(first).toContain('and 7 pages across 2 other kinds');
    expect(first).not.toContain('and 2 other kinds were'); // the non-reconciling disclosure
    expect(narratedExclusionTotal(first)).toBe(60);
  });

  it('at exactly the bound it withholds nothing and says nothing about withholding', () => {
    const excluded = [
      { kind: 'thin', count: 5 },
      { kind: 'archive', count: 3 },
      { kind: 'auth', count: 2 },
    ];
    const first = refusalCopy({
      triggers: ['too_few_gradeable_after_exclusion'],
      coverage: cov({ fetched: 10, gradeable: 0, excluded: excluded as never }),
    }).body.find((b) => b.startsWith('Of the '))!;
    expect(first).toContain('5 pages with too little text to grade, 3 tag or category archives, 2 login or account pages');
    expect(first).not.toContain('across');
    expect(first).not.toContain('other kind');
  });

  it('the singular of the disclosure reads singular', () => {
    const excluded = [
      { kind: 'thin', count: 9 },
      { kind: 'archive', count: 7 },
      { kind: 'auth', count: 5 },
      { kind: 'feed', count: 1 },
    ];
    const first = refusalCopy({
      triggers: ['too_few_gradeable_after_exclusion'],
      coverage: cov({ fetched: 22, gradeable: 0, excluded: excluded as never }),
    }).body.find((b) => b.startsWith('Of the '))!;
    expect(first).toContain('and 1 page across 1 other kind');
    expect(first).not.toContain('1 pages across');
    expect(first).not.toContain('1 other kinds');
  });

  it('rewardguru.in — the live 4-kind row, exactly as production recorded its composition', () => {
    // Production: fetched 118, gradeable 66, excluded thin 39 / archive 9 / auth 1 / search 1. Scaled
    // below the floor so the trigger fires; the COMPOSITION is production's, unaltered.
    const first = refusalCopy({
      triggers: ['too_few_gradeable_after_exclusion'],
      coverage: cov({
        fetched: 51,
        gradeable: 1,
        excluded: [
          { kind: 'thin', count: 39 },
          { kind: 'archive', count: 9 },
          { kind: 'auth', count: 1 },
          { kind: 'search', count: 1 },
        ] as never,
      }),
    }).body.find((b) => b.startsWith('Of the '))!;
    expect(first).toContain('Of the 51 pages we read on this site,');
    expect(first).toContain('and 1 page across 1 other kind');
    expect(narratedExclusionTotal(first)).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROTOTYPE KEYS — the guard the docstring used merely to claim.
//
// `?.` guards `undefined`, not an INHERITED property. Two reviewers proved independently that
// `{ kind: '__proto__' }` THREW out of `refusalCopy` — a render crash on the audit page — and that
// `constructor` / `toString` / `valueOf` rendered garbage phrases. Unreachable (the kind comes from our
// closed-enum classifier, and nothing but our own writer touches `audits.coverage`), but the comment
// claiming the TYPE prevented it was false: types are erased.
// ─────────────────────────────────────────────────────────────────────────────
describe('an inherited property key can never be read back as a phrase', () => {
  const cov = (over: Partial<CoverageAccounting>): CoverageAccounting =>
    ({
      fetched: 0,
      gradeable: 0,
      excluded: [],
      sitemapDeclared: null,
      sitemapRobotsExcluded: null,
      estimatedTotal: null,
      estimateSource: 'none',
      coverageRatio: null,
      ...over,
    }) as CoverageAccounting;

  for (const key of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    it(`renders '${key}' literally instead of throwing or leaking Object.prototype`, () => {
      const render = () =>
        refusalCopy({
          triggers: ['too_few_gradeable_after_exclusion'],
          coverage: cov({ fetched: 13, gradeable: 1, excluded: [{ kind: key, count: 12 }] as never }),
        }).body.join(' ');

      expect(render, `${key} must not throw out of refusalCopy`).not.toThrow();
      const body = render();
      expect(body).toContain(`12 ${key} pages`);
      // None of Object.prototype's stringifications may reach the screen.
      expect(body).not.toContain('[object Object]');
      expect(body).not.toContain('native code');
      expect(body).not.toContain('12 12');
      // …and the arithmetic still holds with an unrecognised kind in the list.
      expect(body).toContain('Of the 13 pages we read on this site,');
      expect(body).toContain('That left 1 content page');
    });
  }

  it('a genuinely new PageKind degrades to its own name rather than crashing', () => {
    // The reachable version of the same path: a kind added to the classifier before its label exists.
    const body = refusalCopy({
      triggers: ['too_few_gradeable_after_exclusion'],
      coverage: cov({ fetched: 9, gradeable: 1, excluded: [{ kind: 'newfangled', count: 8 }] as never }),
    }).body.join(' ');
    expect(body).toContain('8 newfangled pages');
  });
});
