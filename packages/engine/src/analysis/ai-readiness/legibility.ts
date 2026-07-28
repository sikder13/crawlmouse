import type * as cheerio from 'cheerio';
import type { PageAiSignals } from '@crawlmouse/types';
import { toPersistableText } from '../../text-safety.js';
import { JSON_LD_ENTITY_SCAN_MAX_DEPTH, JSON_LD_ENTITY_SCAN_MAX_NODES, JSON_LD_MAX_DEPTH, JSON_LD_MAX_NODES, JSON_LD_MAX_TYPES, JSON_LD_TYPE_MAX_CHARS } from './constants.js';

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
 * Boolean-only walk: does any `@type` anywhere declare an entity? Allocates nothing and short-circuits
 * on the first hit, so its budget can be an order of magnitude larger than the storage walk's without
 * being a memory or CPU risk — the expensive part (`JSON.parse`) has already happened.
 *
 * Compares the RAW value, so a type longer than `JSON_LD_TYPE_MAX_CHARS` is still recognised.
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
    // Descend into EVERY property value, not just `@graph`. Restricting the walk to `@graph` meant a
    // homepage declaring its Organization under an ordinary property — `publisher`, `isPartOf`,
    // `author`, the shape Squarespace/Wix and plain Article markup emit — was reported as declaring no
    // entity at all: the same false `missing_entity_link` and the same 3-point loss this scan exists to
    // prevent, reached by a different route. `@graph`-only happened to cover Yoast/RankMath, which is
    // precisely why the fixtures never caught it.
    //
    // The cost is bounded by the SAME depth and node budgets, so widening the walk cannot widen the
    // worst case: it redistributes a fixed budget over more of the document.
    for (const key of Object.keys(obj)) {
      if (key === '@type') continue;
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
  w.out.push(toPersistableText(raw, JSON_LD_TYPE_MAX_CHARS));
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
