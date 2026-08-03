import { describe, it, expect } from 'vitest';
import { buildGraph } from './graph.js';
import { deriveGradeInputs } from './grade-inputs.js';
import type { CrawledPage, CrawledLink } from './crawler.js';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a §5 / M9 — the gradeable population is NOT the graph.
//
// Owner ruling, and both halves are load-bearing in opposite directions:
//   - excluded pages leave the gradeable POPULATION (numerator AND denominator);
//   - excluded pages REMAIN in the GRAPH as connectivity nodes.
//
// Drop them from the graph and a content page reachable only via a tag archive becomes a false orphan
// — manufacturing the very defect this spec exists to remove. Leave them in the population and 400
// tweet stubs dilute the orphan ratio until a broken site reads as well-linked.
// ─────────────────────────────────────────────────────────────────────────────

const HOME = 'https://s.test';
const page = (url: string): CrawledPage => ({ url, urlHash: `h${url}`, statusCode: 200 });
const link = (from: string, to: string, anchorText = 'go'): CrawledLink =>
  ({ fromUrl: from, toUrl: to, anchorText, isGenericAnchor: false });

const derive = (pages: CrawledPage[], links: CrawledLink[], gradeable: (u: string) => boolean) =>
  deriveGradeInputs(buildGraph(pages, links), { homepageUrl: HOME, isGradeable: gradeable, jsRendered: false });

describe('M9 fixture (a) — a content page linked ONLY from an archive is not an orphan', () => {
  // home -> /tag/seo -> /real-article.  The article has NO inbound link except through the archive.
  const pages = [page(HOME), page(`${HOME}/tag/seo`), page(`${HOME}/real-article`)];
  const links = [link(HOME, `${HOME}/tag/seo`), link(`${HOME}/tag/seo`, `${HOME}/real-article`)];
  const gradeable = (u: string) => !u.includes('/tag/');

  it('does not flag the article as an orphan — crawlers follow archive links', () => {
    const ga = derive(pages, links, gradeable);
    expect(ga.filteredOrphans).toEqual([]);
    expect(ga.orphanRatio).toBe(0);
  });

  it('keeps the article REACHABLE, so it is not counted unreachable either', () => {
    // Depth must be computed over the full graph. Removing the archive node would leave the article
    // with no path from the homepage at all.
    const ga = derive(pages, links, gradeable);
    expect(ga.depths.get(`${HOME}/real-article`)).toBe(2);
    expect(ga.unreachableFraction).toBe(0);
  });

  it('would call it an orphan if the archive were dropped from the graph — the failure M9 prevents', () => {
    // The counterfactual, asserted rather than described: with the archive gone the article has zero
    // inbound links and becomes a critical false orphan. This is what "remain in the graph" buys.
    const withoutArchive = derive([page(HOME), page(`${HOME}/real-article`)], [], gradeable);
    expect(withoutArchive.filteredOrphans).toEqual([`${HOME}/real-article`]);
  });
});

describe('M9 fixture (b) — status stubs leave the numerator AND the denominator', () => {
  // One real orphan among two real pages, plus six tweet stubs that are all orphans.
  const stubs = Array.from({ length: 6 }, (_, i) => `${HOME}/tweets/10000000${i}`);
  const pages = [page(HOME), page(`${HOME}/linked`), page(`${HOME}/orphan`), ...stubs.map(page)];
  const links = [link(HOME, `${HOME}/linked`)];
  const gradeable = (u: string) => !u.includes('/tweets/');

  it('excludes the stubs from the orphan numerator', () => {
    const ga = derive(pages, links, gradeable);
    expect(ga.filteredOrphans).toEqual([`${HOME}/orphan`]);
  });

  it('excludes the stubs from the DENOMINATOR too — the half that changes the grade', () => {
    // Gradeable population is home + /linked + /orphan = 3, so the ratio is 1/3, not 1/9.
    // Leaving the stubs in the denominator is how a junk-diluted site reads as well-linked, and
    // fixing only the numerator would make the grade BETTER rather than more honest.
    const ga = derive(pages, links, gradeable);
    expect(ga.orphanRatio).toBeCloseTo(1 / 3, 10);
  });

  it('the denominator is the gradeable count, not the graph order', () => {
    const ga = derive(pages, links, gradeable);
    expect(ga.gradeableCount).toBe(3);
    // 9 nodes in the graph; using graph.order would give 1/9 = 0.111.
    expect(ga.orphanRatio).not.toBeCloseTo(1 / 9, 3);
  });

  it('an all-excluded crawl yields a 0 ratio rather than a divide-by-zero', () => {
    const ga = derive([page(HOME), ...stubs.map(page)], [], (u) => u !== HOME && !u.includes('/tweets/'));
    expect(Number.isFinite(ga.orphanRatio)).toBe(true);
    expect(ga.orphanRatio).toBe(0);
  });
});

describe('M9 — the structure dimension still sees the whole architecture', () => {
  it('keeps excluded pages as PageRank nodes, because a category page genuinely is architecture', () => {
    const pages = [page(HOME), page(`${HOME}/category/news`), page(`${HOME}/a`), page(`${HOME}/b`)];
    const links = [
      link(HOME, `${HOME}/category/news`),
      link(`${HOME}/category/news`, `${HOME}/a`),
      link(`${HOME}/category/news`, `${HOME}/b`),
      link(`${HOME}/a`, `${HOME}/category/news`),
    ];
    const ga = derive(pages, links, (u) => !u.includes('/category/'));
    // The hub is present in the ranking even though it is not gradeable.
    expect(ga.ranks.has(`${HOME}/category/news`)).toBe(true);
    expect(ga.ranks.get(`${HOME}/category/news`)!).toBeGreaterThan(0);
  });
});

describe('M9 — depth statistics follow the same split', () => {
  it('counts too-deep pages over the gradeable population only', () => {
    // A chain of archives leading to one deep content page: depth is measured through the archives,
    // but only the content page can be COUNTED as too deep.
    const chain = [HOME, `${HOME}/tag/a`, `${HOME}/tag/b`, `${HOME}/tag/c`, `${HOME}/deep-post`];
    const pages = chain.map(page);
    const links = chain.slice(0, -1).map((u, i) => link(u, chain[i + 1]!));
    const ga = derive(pages, links, (u) => !u.includes('/tag/'));
    expect(ga.depths.get(`${HOME}/deep-post`)).toBe(4);          // measured through the archives
    expect(ga.gradeableCount).toBe(2);                            // home + the post
    expect(ga.pagesBeyondDepth3Fraction).toBeCloseTo(1 / 2, 10);  // 1 too-deep of 2 gradeable
  });
});
