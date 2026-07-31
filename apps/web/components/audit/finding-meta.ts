import type { FindingCategory } from '@crawlmouse/types';

// The comprehension layer's content (SPEC 03 Part 2): every finding category gets a plain-language
// label + "what this means" + "why it matters", so a non-expert understands the diagnosis in
// context. Worldwide audience → jargon-light, universal English.
export interface FindingMeta {
  label: string;
  what: string;
  why: string;
  /**
   * COUNTABLE noun phrase for "N x", given explicitly and never derived.
   *
   * `label` is display copy, not grammar: it is a singular noun for some categories ('Orphan page'), a
   * PLURAL for others ('Over-optimized anchors', 'JavaScript-rendered links'), an adjective phrase for
   * one ('Nearly orphaned'), and a mass noun for another ('Vague link text'). A pluraliser that
   * appended 's' to that table therefore shipped "10 over-optimized anchorss" to customers, and would
   * equally have produced "3 nearly orphaneds" and "1 over-optimized anchors". Cased for MID-SENTENCE
   * use, so 'JavaScript' keeps its capitals where a `.toLowerCase()` destroyed them.
   */
  countable: { one: string; other: string };
  /**
   * For categories the engine emits ONCE for the whole site, an uncounted phrase used instead of
   * "N x". Without it the summary says "1 JavaScript-rendered link" for a site whose ENTIRE link graph
   * is invisible to static crawlers, and "1 vague link" for a site over the vague-anchor threshold —
   * both emitted once, site-level (`audit.ts:458` and `:500`), so the count is always 1 and means
   * nothing. The previous copy was wrong in the same way but ungrammatical ("1 javascript-rendered
   * links"); making it grammatical without fixing the UNIT would only make a false statement credible.
   */
  siteWide?: string;
}

const META: Record<FindingCategory, FindingMeta> = {
  orphan: {
    label: 'Orphan page',
    what: 'A page nothing else on your site links to.',
    why: 'Search engines and AI crawlers find pages by following links, so an orphan is rarely discovered or ranked.',
    countable: { one: 'orphan page', other: 'orphan pages' },
  },
  near_orphan: {
    label: 'Nearly orphaned',
    what: 'A page with just one internal link pointing to it.',
    why: 'A single link is fragile — lose it and the page drops off crawlers entirely.',
    countable: { one: 'nearly-orphaned page', other: 'nearly-orphaned pages' },
  },
  deep_page: {
    label: 'Buried page',
    what: 'A page that takes many clicks from the homepage to reach.',
    why: 'Pages deeper than about 3 clicks get crawled less often and receive less ranking signal.',
    countable: { one: 'buried page', other: 'buried pages' },
  },
  unreachable_page: {
    label: 'Unreachable page',
    what: 'A page no link path reaches from the homepage.',
    why: "If a crawler can't walk to it, it effectively doesn't exist for search.",
    countable: { one: 'unreachable page', other: 'unreachable pages' },
  },
  over_optimized_anchor: {
    label: 'Over-optimized anchors',
    what: 'The same exact-match keyword used as link text too often.',
    why: 'Repetitive exact-match anchor text reads as manipulative to search engines.',
    // Emitted per PAGE (`audit.ts:498`), so the unit is pages, not anchors.
    countable: { one: 'page with over-optimized anchor text', other: 'pages with over-optimized anchor text' },
  },
  generic_anchor_overuse: {
    label: 'Vague link text',
    what: 'Links that say "click here" or "read more" instead of describing the destination.',
    why: 'Descriptive anchor text tells search engines (and readers) what the linked page is about.',
    countable: { one: 'vague link', other: 'vague links' },
    siteWide: 'overuse of vague link text', // emitted once, site-level
  },
  under_linked_important: {
    label: 'Under-linked key page',
    what: 'An important page with very few inbound internal links.',
    why: 'Internal links concentrate ranking signal — your key pages deserve more of it.',
    countable: { one: 'under-linked key page', other: 'under-linked key pages' },
  },
  incomplete_crawl: {
    label: 'Partial crawl',
    what: 'We could only reach part of your site.',
    why: 'Your grade is an estimate until the whole site is crawled.',
    countable: { one: 'partial crawl', other: 'partial crawls' },
  },
  js_rendered: {
    label: 'JavaScript-rendered links',
    what: 'Some links appear only after JavaScript runs in the browser.',
    why: "AI crawlers like ChatGPT and Claude don't run JavaScript — they see exactly what Crawlmouse sees. Links that appear only after JavaScript are invisible to them.",
    countable: { one: 'JavaScript-rendered link', other: 'JavaScript-rendered links' },
    siteWide: 'links that only appear after JavaScript runs', // emitted once, site-level
  },
};

const FALLBACK: FindingMeta = {
  label: 'Internal-linking issue',
  what: 'An internal-linking issue we detected.',
  why: 'It affects how easily search engines and AI crawlers find your pages.',
  countable: { one: 'internal-linking issue', other: 'internal-linking issues' },
};

/** Comprehension content for a finding category; tolerates unknown/deprecated categories (U13). */
export function findingMeta(category: string): FindingMeta {
  // OWN-PROPERTY read. `META['__proto__' | 'constructor' | 'toString']` resolves through the prototype
  // chain to an object or a function, so `??` never fires and the caller's `.countable.other` deref
  // throws — taking down a public report page. Pre-existing (`.label.toLowerCase()` threw identically),
  // but this file now dereferences one level deeper, and every sibling map read on this same
  // unvalidated artifact already uses this guard.
  const hit = Object.prototype.hasOwnProperty.call(META, category) ? META[category as FindingCategory] : undefined;
  return hit ?? { ...FALLBACK, label: category || FALLBACK.label };
}
