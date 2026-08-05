import { describe, it, expect } from 'vitest';
import type { CoverageAccounting, RefusalTrigger } from '@crawlmouse/types';
import {
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
  sitemapUnreached: null,
  sitemapRobotsExcluded: null,
  estimatedTotal: null,
  estimateSource: 'none',
  coverageRatio: null,
  ...over,
});

const input = (triggers: RefusalTrigger[], over: Partial<RefusalCopyInput> = {}): RefusalCopyInput => ({
  triggers,
  coverage: coverage(),
  crawl: { fetchedOk: 79, blocked: 0, discovered: 79 },
  siteUrl: 'https://example.com/',
  ...over,
});

const ALL_FIVE: RefusalCopyInput[] = [
  input(['site_too_small_to_measure'], { coverage: coverage({ fetched: 4, gradeable: 4 }), crawl: { fetchedOk: 4, blocked: 0, discovered: 4 } }),
  input(['too_few_gradeable_pages'], { coverage: coverage({ fetched: 3, gradeable: 3, estimatedTotal: 821, estimateSource: 'sitemap' }), crawl: { fetchedOk: 3, blocked: 0, discovered: 821 } }),
  input(['no_observed_links']),
  input(['too_few_gradeable_pages'], { coverage: coverage({ fetched: 1, gradeable: 1, sitemapDeclared: 821, sitemapUnreached: 820, sitemapRobotsExcluded: 0 }) }),
  input(['nothing_read'], { coverage: coverage({ fetched: 50, gradeable: 0 }), crawl: { fetchedOk: 0, blocked: 50, discovered: 50 } }),
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
    crawl: { fetchedOk: 4, blocked: 0, discovered: 4 },
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
    expect(body).toContain('Below 5 pages we don’t publish a letter');
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
    crawl: { fetchedOk: 3, blocked: 0, discovered: 821 },
  }));

  it('says WE fell short, not that the site is small', () => {
    expect(c.headline).toBe('We didn’t read enough of your site to grade it');
    expect(c.body.join(' ')).toContain('We reached 3 of an estimated 821 pages');
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

describe('(d) the sitemap-delta shape — this is the finding, not a caveat', () => {
  const c = refusalCopy(input(['too_few_gradeable_pages'], {
    coverage: coverage({ fetched: 1, gradeable: 1, sitemapDeclared: 821, sitemapUnreached: 820, sitemapRobotsExcluded: 0 }),
  }));

  it('LEADS with the sitemap number, outranking the refusal reason', () => {
    // freepltn. The refusal reason is "we could only reach one page", but the approved copy is
    // explicit that the sitemap number is the more useful answer — so it takes the headline.
    expect(c.headline).toBe('820 of the 821 pages in your sitemap can’t be reached by following links');
    const body = c.body.join(' ');
    expect(body).toContain('Only your homepage is reachable by clicking');
    expect(body).toContain('This is the finding, not a caveat');
  });

  it('still says why no letter follows, without letting it become the headline', () => {
    expect(c.body.join(' ')).toContain('we could only reach one page');
  });

  it('does NOT hijack the headline when the delta is a minority of the sitemap', () => {
    // The shape is "most of your declared site is unreachable". A site with 3 of 900 unreached is not
    // that shape, and promoting it there would bury the real reason.
    const minor = refusalCopy(input(['too_few_gradeable_pages'], {
      coverage: coverage({ fetched: 3, gradeable: 3, sitemapDeclared: 900, sitemapUnreached: 3, sitemapRobotsExcluded: 0, estimatedTotal: 900, estimateSource: 'sitemap' }),
    }));
    expect(minor.headline).toBe('We didn’t read enough of your site to grade it');
  });
});

describe('(e) nothing_read — the server returned nothing', () => {
  const c = refusalCopy(input(['nothing_read'], {
    coverage: coverage({ fetched: 50, gradeable: 0 }),
    crawl: { fetchedOk: 0, blocked: 50, discovered: 50 },
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
      crawl: { fetchedOk: 0, blocked: 50, discovered: 50 },
    }));
    expect(c.headline).toBe('Your server didn’t return a single page to us');
  });

  it('the below-floor reason outranks no_observed_links — at 3 pages, "no links" is a consequence', () => {
    // On a 3-page site the absent edges are a property of the tiny sample, not an independent
    // finding, so leading with them would misattribute the cause.
    const c = refusalCopy(input(['site_too_small_to_measure', 'no_observed_links'], {
      coverage: coverage({ fetched: 3, gradeable: 3 }),
      crawl: { fetchedOk: 3, blocked: 0, discovered: 3 },
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
