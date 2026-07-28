import type * as cheerio from 'cheerio';
import type { PageAiSignals } from '@crawlmouse/types';
import { toPersistableText } from '../../text-safety.js';
import { JSON_LD_ENTITY_SCAN_MAX_DEPTH, JSON_LD_ENTITY_SCAN_MAX_NODES, JSON_LD_MAX_DEPTH, JSON_LD_MAX_NODES, JSON_LD_MAX_TYPES, JSON_LD_TYPE_MAX_BYTES } from './constants.js';

type LegibilitySignals = Pick<
  PageAiSignals,
  'hasTitle' | 'hasMetaDescription' | 'h1Count' | 'headingLevelsSkipped' | 'hasMainLandmark' | 'jsonLd'
>;

/**
 * §5 — per-page machine-legibility signals, all parse-time and deterministic: title present, meta
 * description present, H1 count, skipped-heading-level detection, main landmark, and JSON-LD validity +
 * collected @types. Read from the shared `$` non-destructively (no mutation, no second parse).
 */
export function analyzeLegibility($: cheerio.CheerioAPI): LegibilitySignals {
  return {
    hasTitle: $('title').first().text().trim().length > 0,
    hasMetaDescription: ($('meta[name="description"]').attr('content') ?? '').trim().length > 0,
    h1Count: $('h1').length,
    headingLevelsSkipped: detectSkippedHeadings($),
    hasMainLandmark: $('main, article, [role="main"]').length > 0,
    jsonLd: analyzeJsonLd($),
  };
}

/** True when the heading outline steps DOWN by more than one level (e.g. h1→h3), a machine-legibility gap. */
function detectSkippedHeadings($: cheerio.CheerioAPI): boolean {
  let prev = 0;
  let skipped = false;
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const level = Number(String($(el).prop('tagName')).charAt(1));
    if (prev !== 0 && level > prev + 1) skipped = true;
    prev = level;
  });
  return skipped;
}

/**
 * §5 — JSON-LD: `present` when any `<script type="application/ld+json">` exists; `valid` when EVERY such
 * block parses; `types` = the collected, deduped `@type` values (incl. `@graph` nesting + `@type` arrays).
 * Deterministic order (first-occurrence). Malformed JSON ⇒ `invalid_structured_data` upstream.
 */
function analyzeJsonLd($: cheerio.CheerioAPI): {
  present: boolean;
  valid: boolean;
  types: string[];
  hasEntityType: boolean;
} {
  const scripts = $('script[type="application/ld+json"]');
  if (scripts.length === 0) return { present: false, valid: false, types: [], hasEntityType: false };
  let valid = true;
  let hasEntityType = false;
  // CHECK BEFORE CAP. The homepage-entity signal is decided by its OWN scan, before any storage cap
  // exists, and `assemble` reads that boolean — never the capped array.
  //
  // Reading the signal off the capped array made the caps change the SCORE and emit a factually FALSE
  // `missing_entity_link` finding ("this homepage does not declare an Organization") on a homepage that
  // declares one, whenever `Organization` fell past the 20-type cap or the storage walk's node budget.
  // Measured: 25 filler types then Organization ⇒ finding emitted, AI score 94 → 91.
  //
  // A "was truncated" flag would only have suppressed the symptom. Deciding the boolean first removes
  // the possibility: the entity walk allocates nothing (it sets one bit), so it gets its own, far more
  // generous budget and cannot be starved by a hostile page's type volume.
  const parsed: unknown[] = [];
  scripts.each((_, el) => {
    try {
      parsed.push(JSON.parse($(el).text()));
    } catch {
      valid = false;
    }
  });

  const entityBudget = { nodes: JSON_LD_ENTITY_SCAN_MAX_NODES };
  for (const node of parsed) {
    if (scanForEntityType(node, entityBudget, 0)) {
      hasEntityType = true;
      break;
    }
  }

  // THEN cap for storage. Deduping DURING the walk rather than after it is what makes the cap a real
  // bound on work: a collect-then-dedupe pass still materialises every duplicate first, so `@graph`
  // with 20 000 copies of one type costs 20 000 strings to produce a one-element result.
  const walk: TypeWalk = { nodes: JSON_LD_MAX_NODES, raw: new Set(), out: [] };
  for (const node of parsed) collectTypes(node, walk, 0);

  return { present: true, valid, types: walk.out, hasEntityType };
}

/** The `@type` values that make a homepage a declared entity (§5). Compared BEFORE any truncation. */
const ENTITY_TYPES = new Set(['Organization', 'WebSite']);

/**
 * Property positions that can ONLY mean "this site declares itself".
 *
 * The first attempt descended into EVERY property, which credited entities the site does not own: a
 * shop selling Nike gear (`brand`), a job ad (`hiringOrganization`), a review of a competitor
 * (`itemReviewed`) all scored as if they had declared themselves. The finding this credit suppresses
 * reads "no structured anchor for WHO THIS SITE IS", so crediting a third party is a factually wrong
 * +3 points — and a false positive is worse than a false negative here, because it silently removes a
 * true finding rather than adding a visible one.
 *
 * `author` is a traversal position, not a credit position: it is here so `author.worksFor` is
 * reachable, which is a self-declaration.
 *
 * RULE for anything not listed: include it only if it can ONLY mean self-declaration. When in doubt,
 * exclude. Deliberately excluded: brand, itemReviewed, hiringOrganization, seller, sponsor, funder,
 * about — each of which routinely names someone else.
 */
const SELF_DECLARING_KEYS = new Set([
  '@graph',
  'publisher',
  'isPartOf',
  'mainEntity',
  'mainEntityOfPage',
  'sourceOrganization',
  'provider',
  'author',
  'worksFor',
]);

/**
 * Boolean-only walk: does this document declare an entity for ITSELF? Allocates nothing and
 * short-circuits on the first hit, so its budget can exceed the storage walk's without being a memory
 * or CPU risk — `JSON.parse`, the expensive part, has already run.
 *
 * Descending only self-declaring keys also keeps the budget from being starved by unrelated subtrees:
 * the all-properties version could be exhausted by 150 KB of decoy JSON before reaching a real
 * `@graph`, turning a site that DOES declare an Organization into a false `missing_entity_link`.
 *
 * Compares the RAW value, so a type longer than the storage cap is still recognised.
 */
function scanForEntityType(node: unknown, budget: { nodes: number }, depth: number): boolean {
  if (depth > JSON_LD_ENTITY_SCAN_MAX_DEPTH || budget.nodes <= 0) return false;
  budget.nodes -= 1;
  if (Array.isArray(node)) {
    for (const n of node) if (scanForEntityType(n, budget, depth + 1)) return true;
    return false;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const t = obj['@type'];
    if (typeof t === 'string' && ENTITY_TYPES.has(t)) return true;
    if (Array.isArray(t)) {
      for (const x of t) {
        budget.nodes -= 1;
        if (budget.nodes <= 0) return false;
        if (typeof x === 'string' && ENTITY_TYPES.has(x)) return true;
      }
    }
    for (const key of SELF_DECLARING_KEYS) {
      const v = obj[key];
      if (v !== null && typeof v === 'object' && scanForEntityType(v, budget, depth + 1)) return true;
    }
  }
  return false;
}

/** Walk state, shared across every script block on the page so N blocks cannot multiply any ceiling. */
interface TypeWalk {
  nodes: number;          // remaining node budget
  raw: Set<string>;       // values already seen, PRE-truncation
  out: string[];          // collected, truncated, in first-occurrence order
}

function collectTypes(node: unknown, w: TypeWalk, depth: number): void {
  if (depth > JSON_LD_MAX_DEPTH || w.nodes <= 0 || w.out.length >= JSON_LD_MAX_TYPES) return;
  w.nodes -= 1;
  if (Array.isArray(node)) {
    for (const n of node) collectTypes(n, w, depth + 1);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const t = obj['@type'];
    if (typeof t === 'string') addType(w, t);
    else if (Array.isArray(t)) {
      // A `@type` ARRAY is a work axis of its own: without charging per element, a single node charge
      // could walk a million-element array — exactly the wide-but-shallow shape the budget exists for.
      for (const x of t) {
        w.nodes -= 1;
        if (w.nodes <= 0) return;
        if (typeof x === 'string') addType(w, x);
      }
    }
    if (Array.isArray(obj['@graph'])) collectTypes(obj['@graph'], w, depth + 1);
  }
}

/**
 * Dedupe on the RAW value, then store the truncated one. Truncating first collapsed distinct type IRIs
 * that happen to share a 100-char prefix into ONE entry — 20 000 distinct types became a single-element
 * array, which also made a size assertion pass for the wrong reason.
 */
function addType(w: TypeWalk, raw: string): void {
  if (w.out.length >= JSON_LD_MAX_TYPES || w.raw.has(raw)) return;
  w.raw.add(raw);
  w.out.push(toPersistableText(raw, JSON_LD_TYPE_MAX_BYTES));
}

/**
 * §4 framework marker — EXPLANATION only, never a verdict. High-confidence signals only (a generic `#root`
 * / `#app` alone is NOT claimed as a specific framework; the CSR signals already capture mount emptiness).
 */
export function detectFrameworkMarker($: cheerio.CheerioAPI): string | null {
  if ($('#__next').length > 0 || $('script#__NEXT_DATA__').length > 0) return 'nextjs';
  if ($('#__nuxt').length > 0 || $('#__layout').length > 0) return 'nuxt';
  if ($('#___gatsby').length > 0) return 'gatsby';
  if ($('[data-reactroot]').length > 0) return 'react';
  return null;
}
