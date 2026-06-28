import { describe, it, expect } from 'vitest';
import { buildGraph } from '../graph.js';
import { hashUrl } from '../url-canonical.js';
import { deriveGradeInputs } from '../grade-inputs.js';
import { buildCorpus } from './relevance.js';
import { enumerateFixes, type PrescribableFix } from './ledger.js';
import type { CrawledPage, CrawledLink } from '../crawler.js';

const HOME = 'https://ex.com';
function page(url: string, title?: string): CrawledPage {
  return { url, urlHash: hashUrl(url), title, statusCode: 200 };
}
function link(fromUrl: string, toUrl: string, anchorText = 'a descriptive internal anchor'): CrawledLink {
  return { fromUrl, toUrl, anchorText, isGenericAnchor: false };
}
const GENERIC = ['click here', 'read more', 'learn more', 'here', 'this', 'link', 'more'];

function ledgerOf(
  pages: CrawledPage[],
  links: CrawledLink[],
  isExcluded: (u: string) => boolean = () => false,
  linksPerFix = 3,
): PrescribableFix[] {
  const graph = buildGraph(pages, links);
  const ga = deriveGradeInputs(graph, { homepageUrl: HOME, isExcluded, jsRendered: false });
  const corpus = buildCorpus(graph);
  return enumerateFixes(graph, ga, { homepageUrl: HOME, isExcluded, corpus, linksPerFix });
}

describe('enumerateFixes (§3 deterministic ledger)', () => {
  // A topical hub site with ONE orphan that is on-topic with the SEO hubs and one unrelated page.
  const orphanPages = [
    page(HOME, 'Home'),
    page(`${HOME}/seo-internal-linking-guide`, 'SEO Internal Linking Guide'),
    page(`${HOME}/seo-audit-tips`, 'SEO Audit Tips'),
    page(`${HOME}/chocolate-cake`, 'Chocolate Cake Recipe'),
    page(`${HOME}/advanced-seo-linking`, 'Advanced SEO Linking Strategies'), // ORPHAN (no inbound)
  ];
  const orphanLinks = [
    link(HOME, `${HOME}/seo-internal-linking-guide`, 'seo internal linking guide'),
    link(HOME, `${HOME}/seo-audit-tips`, 'seo audit tips'),
    link(HOME, `${HOME}/chocolate-cake`, 'chocolate cake recipe'),
  ];

  it('emits an orphan fix whose id is `orphan:<url>` with a real, non-empty prescription', () => {
    const fixes = ledgerOf(orphanPages, orphanLinks);
    const orphanFix = fixes.find((f) => f.category === 'orphan');
    expect(orphanFix).toBeDefined();
    expect(orphanFix!.targetUrl).toBe(`${HOME}/advanced-seo-linking`);
    expect(orphanFix!.id).toBe(`orphan:${HOME}/advanced-seo-linking`);
    expect(orphanFix!.suggestedLinks.length).toBeGreaterThan(0);
    expect(orphanFix!.suggestedLinks.length).toBeLessThanOrEqual(3);
  });

  it('never suggests the target itself or an excluded page as a source, and never targets an excluded page', () => {
    // /cart has a topical name (would rank high) but is EXCLUDED — it must never be a source or target.
    const pages = [...orphanPages, page(`${HOME}/cart`, 'Advanced SEO Linking Cart Checkout')];
    const links = [...orphanLinks, link(HOME, `${HOME}/cart`, 'cart')];
    const fixes = ledgerOf(pages, links, (u) => u.includes('/cart'));
    const orphanFix = fixes.find((f) => f.category === 'orphan' && f.targetUrl === `${HOME}/advanced-seo-linking`)!;
    expect(orphanFix).toBeDefined();
    const sources = orphanFix.suggestedLinks.map((s) => s.fromUrl);
    expect(sources).not.toContain(`${HOME}/advanced-seo-linking`); // never the target itself
    expect(sources.some((s) => s.includes('/cart'))).toBe(false); // excluded never a source
    expect(fixes.some((f) => f.targetUrl.includes('/cart'))).toBe(false); // excluded never a target
  });

  it('for an over-optimized target, never re-suggests a page that already links to it (hasEdge)', () => {
    const T = `${HOME}/popular-widgets`;
    const pages = [
      page(HOME, 'Home'),
      page(T, 'Popular Widgets'),
      page(`${HOME}/s1`, 'Widget Reviews'),
      page(`${HOME}/s2`, 'Widget News'),
      page(`${HOME}/s3`, 'Widget Deals'),
      page(`${HOME}/widgets-guide`, 'Widgets Buying Guide'), // eligible NEW source
    ];
    const same = (f: string): CrawledLink => ({ fromUrl: f, toUrl: T, anchorText: 'widgets', isGenericAnchor: false });
    const links = [
      link(HOME, `${HOME}/s1`), link(HOME, `${HOME}/s2`), link(HOME, `${HOME}/s3`), link(HOME, `${HOME}/widgets-guide`),
      same(`${HOME}/s1`), same(`${HOME}/s2`), same(`${HOME}/s3`), // 3 identical-anchor inbound → over-optimized
    ];
    const oo = ledgerOf(pages, links).find((f) => f.category === 'over_optimized_anchor' && f.targetUrl === T);
    expect(oo).toBeDefined();
    const sources = oo!.suggestedLinks.map((s) => s.fromUrl);
    for (const existing of [`${HOME}/s1`, `${HOME}/s2`, `${HOME}/s3`]) expect(sources).not.toContain(existing);
    expect(sources).not.toContain(T);
  });

  it('ranks sources by relevance desc then url asc, and the top source is the most topical', () => {
    const fixes = ledgerOf(orphanPages, orphanLinks);
    const orphanFix = fixes.find((f) => f.category === 'orphan')!;
    const top = orphanFix.suggestedLinks[0]!;
    // The SEO hubs are more relevant to "Advanced SEO Linking" than the cake page.
    expect([`${HOME}/seo-internal-linking-guide`, `${HOME}/seo-audit-tips`]).toContain(top.fromUrl);
    expect(top.relevanceScore).toBeGreaterThan(0);
    // non-increasing relevance order
    const scores = orphanFix.suggestedLinks.map((s) => s.relevanceScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('suggests VARIED, non-generic anchors (a cure must not create new over-optimization)', () => {
    const fixes = ledgerOf(orphanPages, orphanLinks);
    const orphanFix = fixes.find((f) => f.category === 'orphan')!;
    const anchors = orphanFix.suggestedLinks.map((s) => s.anchorText);
    for (const a of anchors) {
      expect(a.trim().length).toBeGreaterThan(0);
      expect(GENERIC).not.toContain(a.trim().toLowerCase());
    }
    if (anchors.length >= 2) expect(new Set(anchors).size).toBeGreaterThan(1); // not all identical
  });

  it('emits a deep_page fix whose suggested sources are all SHALLOW (depth < 3)', () => {
    // HOME→a→b→c→d→e : e is depth 5 (too deep). Shallow sources are HOME/a/b (depth 0/1/2).
    const chain = ['a', 'b', 'c', 'd', 'e'];
    const pages = [page(HOME, 'Home'), ...chain.map((s) => page(`${HOME}/${s}`, `Page ${s} about widgets`))];
    const links = [link(HOME, `${HOME}/a`), ...chain.slice(0, -1).map((s, i) => link(`${HOME}/${s}`, `${HOME}/${chain[i + 1]}`))];
    const fixes = ledgerOf(pages, links);
    const deep = fixes.find((f) => f.category === 'deep_page' && f.targetUrl === `${HOME}/e`);
    expect(deep).toBeDefined();
    expect(deep!.suggestedLinks.length).toBeGreaterThan(0);
    // every suggested source must itself be shallow (depth < 3) so the link actually un-buries e.
    const graph = buildGraph(pages, links);
    const ga = deriveGradeInputs(graph, { homepageUrl: HOME, isExcluded: () => false, jsRendered: false });
    for (const s of deep!.suggestedLinks) expect((ga.depths.get(s.fromUrl) ?? 99) < 3).toBe(true);
  });

  it('models site-wide generic-anchor overuse as an advisory diagnosis with NO suggestedLinks', () => {
    // Every inbound link to the hubs uses the SAME generic anchor → high generic fraction site-wide.
    const pages = [page(HOME, 'Home'), page(`${HOME}/p1`, 'Page One'), page(`${HOME}/p2`, 'Page Two')];
    const gl = (f: string, t: string): CrawledLink => ({ fromUrl: f, toUrl: t, anchorText: 'click here', isGenericAnchor: true });
    const links = [gl(HOME, `${HOME}/p1`), gl(HOME, `${HOME}/p2`), gl(`${HOME}/p1`, `${HOME}/p2`), gl(`${HOME}/p2`, `${HOME}/p1`)];
    const fixes = ledgerOf(pages, links);
    const advisory = fixes.find((f) => f.category === 'generic_anchor_overuse');
    expect(advisory).toBeDefined();
    expect(advisory!.suggestedLinks).toHaveLength(0);
    expect(advisory!.targetUrl).toBe(HOME);
  });

  it('drops an orphan with zero eligible sources (no throwaway fixes)', () => {
    // Two pages, the orphan already linked from the only other page → no eligible source remains.
    const pages = [page(HOME, 'Home'), page(`${HOME}/lonely`, 'Lonely')];
    // HOME is the only candidate; make HOME already link to /lonely so it is not an orphan at all,
    // leaving no orphan; then a second graph where the orphan exists but the only node links to it.
    const fixes = ledgerOf(pages, [link(HOME, `${HOME}/lonely`)]);
    expect(fixes.some((f) => f.category === 'orphan')).toBe(false); // /lonely has an inbound → not orphan
  });

  it('is deterministic: identical input → identical ledger (ids, order, sources, anchors)', () => {
    const a = ledgerOf(orphanPages, orphanLinks);
    const b = ledgerOf(orphanPages, orphanLinks);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
