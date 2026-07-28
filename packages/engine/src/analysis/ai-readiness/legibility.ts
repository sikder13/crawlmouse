import type * as cheerio from 'cheerio';
import type { PageAiSignals } from '@crawlmouse/types';
import { toPersistableText } from '../../text-safety.js';
import { JSON_LD_MAX_DEPTH, JSON_LD_MAX_NODES, JSON_LD_MAX_TYPES, JSON_LD_TYPE_MAX_CHARS } from './constants.js';

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
function analyzeJsonLd($: cheerio.CheerioAPI): { present: boolean; valid: boolean; types: string[] } {
  const scripts = $('script[type="application/ld+json"]');
  if (scripts.length === 0) return { present: false, valid: false, types: [] };
  let valid = true;
  // Deduping DURING the walk rather than after it is what makes the cap a real bound on work: a
  // collect-then-dedupe pass still materialises every duplicate first, so `@graph` with 20 000 copies
  // of one type costs 20 000 strings to produce a one-element result.
  const seen = new Set<string>();
  const budget = { nodes: JSON_LD_MAX_NODES };
  scripts.each((_, el) => {
    try {
      collectTypes(JSON.parse($(el).text()), seen, budget, 0);
    } catch {
      valid = false;
    }
  });
  return { present: true, valid, types: [...seen] };
}

/**
 * Walk `@type` (+ `@type` arrays + nested `@graph`) collecting deduped type names, in first-occurrence
 * order (deterministic — Set preserves insertion order).
 *
 * Every string is run through `toPersistableText` AS IT IS COLLECTED, not afterwards, because
 * `JSON.parse` accepts an unpaired `\uXXXX` escape: `{"@type":"\ud800"}` is 40 bytes of valid JSON
 * that yields a lone surrogate, which Postgres then refuses in jsonb — failing the pages insert and
 * with it the entire audit. This is the ONE inbound (uncut) source of malformed UTF-16 in the codebase.
 *
 * Bounded on all four axes; `budget` is shared across every script block on the page so N blocks
 * cannot multiply the ceiling.
 */
function collectTypes(node: unknown, out: Set<string>, budget: { nodes: number }, depth: number): void {
  if (depth > JSON_LD_MAX_DEPTH || budget.nodes <= 0 || out.size >= JSON_LD_MAX_TYPES) return;
  budget.nodes -= 1;
  if (Array.isArray(node)) {
    for (const n of node) collectTypes(n, out, budget, depth + 1);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const t = obj['@type'];
    if (typeof t === 'string') addType(out, t);
    else if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') addType(out, x);
    if (Array.isArray(obj['@graph'])) collectTypes(obj['@graph'], out, budget, depth + 1);
  }
}

function addType(out: Set<string>, raw: string): void {
  if (out.size >= JSON_LD_MAX_TYPES) return;
  out.add(toPersistableText(raw, JSON_LD_TYPE_MAX_CHARS));
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
