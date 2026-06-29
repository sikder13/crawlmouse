import type { FindingCategory } from '@crawlmouse/types';

// The comprehension layer's content (SPEC 03 Part 2): every finding category gets a plain-language
// label + "what this means" + "why it matters", so a non-expert understands the diagnosis in
// context. Worldwide audience → jargon-light, universal English.
export interface FindingMeta {
  label: string;
  what: string;
  why: string;
}

const META: Record<FindingCategory, FindingMeta> = {
  orphan: {
    label: 'Orphan page',
    what: 'A page nothing else on your site links to.',
    why: 'Search engines and AI crawlers find pages by following links, so an orphan is rarely discovered or ranked.',
  },
  near_orphan: {
    label: 'Nearly orphaned',
    what: 'A page with just one internal link pointing to it.',
    why: 'A single link is fragile — lose it and the page drops off crawlers entirely.',
  },
  deep_page: {
    label: 'Buried page',
    what: 'A page that takes many clicks from the homepage to reach.',
    why: 'Pages deeper than about 3 clicks get crawled less often and receive less ranking signal.',
  },
  unreachable_page: {
    label: 'Unreachable page',
    what: 'A page no link path reaches from the homepage.',
    why: "If a crawler can't walk to it, it effectively doesn't exist for search.",
  },
  over_optimized_anchor: {
    label: 'Over-optimized anchors',
    what: 'The same exact-match keyword used as link text too often.',
    why: 'Repetitive exact-match anchor text reads as manipulative to search engines.',
  },
  generic_anchor_overuse: {
    label: 'Vague link text',
    what: 'Links that say "click here" or "read more" instead of describing the destination.',
    why: 'Descriptive anchor text tells search engines (and readers) what the linked page is about.',
  },
  under_linked_important: {
    label: 'Under-linked key page',
    what: 'An important page with very few inbound internal links.',
    why: 'Internal links concentrate ranking signal — your key pages deserve more of it.',
  },
  incomplete_crawl: {
    label: 'Partial crawl',
    what: 'We could only reach part of your site.',
    why: 'Your grade is an estimate until the whole site is crawled.',
  },
  js_rendered: {
    label: 'JavaScript-rendered links',
    what: 'Some links appear only after JavaScript runs in the browser.',
    why: "AI crawlers like ChatGPT and Claude don't run JavaScript — they see exactly what Crawlmouse sees. Links that appear only after JavaScript are invisible to them.",
  },
};

const FALLBACK: FindingMeta = {
  label: 'Internal-linking issue',
  what: 'An internal-linking issue we detected.',
  why: 'It affects how easily search engines and AI crawlers find your pages.',
};

/** Comprehension content for a finding category; tolerates unknown/deprecated categories (U13). */
export function findingMeta(category: string): FindingMeta {
  return META[category as FindingCategory] ?? { ...FALLBACK, label: category || FALLBACK.label };
}
