/**
 * SPEC 05 — AI / Agent-Readiness constants (self-contained; see Amendment v1.1 §5/§7).
 *
 * These are the tuning knobs for the sibling AI-readiness score ONLY. They live in the ai-readiness
 * module — NOT the engine's grade `constants.ts` — so the A–F grading contract stays untouched
 * (§13.1/§13.2) and this feature is self-contained. All defaults are the Stage 0-plan values the owner
 * pinned. `js-detect.ts` and its `SPA_ROOT_SELECTORS` are deliberately NOT reused (per-page vs site-level
 * differ, and touching them risks the grade); the CSR mount set below is a superset defined here.
 */
import type { AiBotClass } from '@crawlmouse/types';

// ── §4.2 classification thresholds (the dual gate) ──────────────────────────────
/** `mainTextChars` at/above which a page is `readable` regardless of framework markers. */
export const MIN_MAIN_TEXT_CHARS = 200;
/** Below this, a page with affirmative CSR signals is `js_blind`; between this and MIN it is `partial`. */
export const PARTIAL_FLOOR = 50;

// ── §4.4 excerpt ────────────────────────────────────────────────────────────────
/** Max chars of post-density-filter main-content text in the "What AI Sees" excerpt (word-boundary trunc). */
export const EXCERPT_MAX_CHARS = 2000;

// ── §4.1 boilerplate stripping (HIGH-PRECISION, NO wildcards) ───────────────────
/**
 * Structural non-content elements stripped before main-content extraction (§4.1 step 1). The engine's
 * existing `NON_CONTENT_SELECTOR` (js-detect.ts) does NOT cover nav/footer/header/aside — those are new
 * here. Applied to a CLONE of the content root so the shared `$` is never mutated (link extraction, which
 * reads nav/footer links, must be unaffected).
 */
export const AI_STRUCTURAL_STRIP =
  'nav, footer, header, aside, script, style, noscript, template, svg, [role="navigation"], [role="banner"], [role="contentinfo"]';

/**
 * Consent-management-platform containers stripped by EXACT id/class (§4.1 step 2). NO wildcard/substring
 * matches (a `[class*="banner"]` would strip hero content). Most CMPs inject client-side and barely exist
 * in static HTML; this catches the few that ship server-side. Fixture-pinned (A3).
 */
export const CMP_STRIP_SELECTORS =
  '#onetrust-consent-sdk, #CybotCookiebotDialog, .cc-window, #usercentrics-root, #cookiescript_injected, #cookie-law-info-bar';

/**
 * Kohlschütter shallow block-density filter (§4.1 step 3): a candidate block whose link-text share of its
 * own text is at or above this is boilerplate (a nav/menu that survived structural strip) and its text is
 * dropped. 0.5 = "more than half this block is link text" → not prose.
 */
export const MAX_BLOCK_LINK_DENSITY = 0.5;

/**
 * The discriminator between a MENU and a CARD GRID — both are link-dense. A menu's links are SHORT (a word
 * or two: "Home", "About"), so its average text-per-link is small; a blog-index / card grid wraps a real
 * title+blurb in each link, so its average is large. A link-dense block is dropped ONLY when its average
 * link text is below this — so menus are stripped from the excerpt but card content is preserved. This is
 * a container-level test (no leaf heuristic), which is what lets the density filter run in a single O(n)
 * pass. Fixture-tunable.
 */
export const MENU_AVG_LINK_CHARS = 30;

/**
 * Per-page CSR mount nodes (§4.2). A SUPERSET of js-detect's `SPA_ROOT_SELECTORS` — adds Nuxt (#__nuxt,
 * #__layout) which the site-level set lacks (Amendment §5 / Stage 0 M6). Used ONLY by the per-page
 * classifier; js-detect.ts is untouched.
 */
export const AI_CSR_MOUNT_SELECTORS = [
  '#root',
  '#app',
  '#__next',
  '#__nuxt',
  '#__layout',
  '[data-reactroot]',
  '#___gatsby',
] as const;

/**
 * §4.2 FRAMEWORK-SPECIFIC mount subset. A NON-empty mount + a JS bundle is only treated as a hydration
 * shell for these framework-specific ids — NOT for the generic `#root`/`#app`, which a thin STATIC page
 * commonly uses as a plain wrapper (a bundle could be mere analytics/jQuery). This preserves the
 * conservative bias: "a contact page must never be called JS-blind" (§4.2). An EMPTY mount of ANY id in
 * `AI_CSR_MOUNT_SELECTORS` is still a strong CSR signal (handled separately).
 */
export const AI_FRAMEWORK_MOUNT_SELECTORS = ['#__next', '#__nuxt', '#__layout', '[data-reactroot]', '#___gatsby'] as const;

/** §4.2 noscript "enable JavaScript" notice — an affirmative CSR signal. */
export const NOSCRIPT_JS_NOTICE = /enable JavaScript|requires JavaScript|need.*JavaScript/i;

/**
 * Max chars of a `<noscript>` body scanned by `NOSCRIPT_JS_NOTICE`. The unanchored `need.*JavaScript`
 * alternative backtracks quadratically, so an attacker-controlled multi-hundred-KB `<noscript>` could
 * burn seconds of synchronous CPU on the crawl hot path. A genuine notice is short; cap the scan.
 */
export const NOTICE_SCAN_CAP = 4096;

// ── §7 score assembly (weights, bands, per-class subscores) ─────────────────────
/** Component weights (LOCKED, §1/§7). Must sum to 100. Access 25 / Content 40 / Legibility 20 / Retrieval 15. */
export const AI_COMPONENT_WEIGHTS = {
  access: 25,
  contentWithoutJs: 40,
  machineLegibility: 20,
  retrievalPath: 15,
} as const;

/** §4.3 per-page content subscore by class (mean over eligible nodes). thin = 1.0 (no JS problem). */
export const PAGE_CLASS_SUBSCORE: Record<'readable' | 'partial' | 'js_blind' | 'thin', number> = {
  readable: 1.0,
  thin: 1.0,
  partial: 0.5,
  js_blind: 0,
};

/** §7 band thresholds on the 0..100 score. `ready ≥ 80`, `partial 50–79`, `at_risk < 50`. */
export const AI_BAND_READY_MIN = 80;
export const AI_BAND_PARTIAL_MIN = 50;

/** §5 legibility component blend: per-page checks mean vs the site-level homepage-entity sub-signal. */
export const LEGIBILITY_PERPAGE_WEIGHT = 0.85;
export const LEGIBILITY_ENTITY_WEIGHT = 0.15;

/**
 * §2/§7 evidence-table snapshot date, rendered as "crawler behavior verified as of …". A PINNED constant
 * (not the run time) so the score stays deterministic (R1) — the JS-rendering table is a snapshot and we
 * date it honestly.
 */
export const AI_EVIDENCE_AS_OF = '2026-07-01';

// ── §3 bot registry (single source of truth) ───────────────────────────────────
export interface AiBotDef {
  token: string;
  operator: string;
  botClass: AiBotClass;
  /** Static plain-language descriptor; the matrix composes the per-site note from this + access state. */
  note: string;
}

/**
 * §3 AI crawler registry. Retrieval-class bots drive citations (blocking them costs visibility → SCORED);
 * training-class blocks are a legitimate owner policy (reported, NOT scored); opt-out tokens are policy
 * tokens applied to the operator's MAIN crawler, not separate crawlers (described exactly, never scored).
 */
export const AI_BOT_REGISTRY: readonly AiBotDef[] = [
  // retrieval (citation-driving) — SCORED
  { token: 'OAI-SearchBot', operator: 'OpenAI', botClass: 'retrieval', note: 'Fetches pages for ChatGPT search results and citations.' },
  { token: 'ChatGPT-User', operator: 'OpenAI', botClass: 'retrieval', note: 'Fetches a page when a ChatGPT user follows or asks about a link.' },
  { token: 'Claude-SearchBot', operator: 'Anthropic', botClass: 'retrieval', note: 'Fetches pages for Claude search results and citations.' },
  { token: 'Claude-User', operator: 'Anthropic', botClass: 'retrieval', note: 'Fetches a page when a Claude user follows or asks about a link.' },
  { token: 'PerplexityBot', operator: 'Perplexity', botClass: 'retrieval', note: 'Indexes pages for Perplexity answers and citations.' },
  { token: 'Perplexity-User', operator: 'Perplexity', botClass: 'retrieval', note: 'Fetches a page when a Perplexity user follows a link.' },
  // training (model-training corpus) — REPORTED, not scored
  { token: 'GPTBot', operator: 'OpenAI', botClass: 'training', note: "Collects pages for OpenAI model training. Blocking it does not affect ChatGPT citations." },
  { token: 'ClaudeBot', operator: 'Anthropic', botClass: 'training', note: 'Collects pages for Anthropic model training.' },
  { token: 'CCBot', operator: 'Common Crawl', botClass: 'training', note: 'Common Crawl corpus; widely reused for model training datasets.' },
  { token: 'Meta-ExternalAgent', operator: 'Meta', botClass: 'training', note: 'Collects pages for Meta AI model training.' },
  { token: 'Bytespider', operator: 'ByteDance', botClass: 'training', note: 'Collects pages for ByteDance model training.' },
  { token: 'Amazonbot', operator: 'Amazon', botClass: 'training', note: 'Collects pages for Amazon services and model training.' },
  // opt-out tokens — described exactly, never scored
  { token: 'Google-Extended', operator: 'Google', botClass: 'opt_out_token', note: 'A training/grounding OPT-OUT token applied to Googlebot — not a separate crawler. Disallowing it does not block Google Search.' },
  { token: 'Applebot-Extended', operator: 'Apple', botClass: 'opt_out_token', note: 'A training OPT-OUT token applied to Applebot — not a separate crawler. Disallowing it does not block Siri/Spotlight indexing.' },
];

// ── §3 WAF disclosure (EXACT header names only — Amendment refinement; NO prefix patterns) ──────
export interface WafHeaderRule {
  /** Exact response-header name (lowercased). No prefixes/wildcards. */
  header: string;
  /** Exact value match (case-insensitive) when set; otherwise mere presence of the header is the signal. */
  equals?: string;
  vendor: string;
}

/**
 * §3 WAF/CDN disclosure allowlist — HIGH-PRECISION, exact header names only (no `x-akamai-*` prefixes).
 * Detection is DISCLOSURE-ONLY (§2): it sets `wafDetected`/`wafNote` and NEVER moves the score. A false
 * positive erodes trust, so the set stays small and exact; fixture-pinned (A7).
 */
export const WAF_HEADER_ALLOWLIST: readonly WafHeaderRule[] = [
  { header: 'server', equals: 'cloudflare', vendor: 'Cloudflare' },
  { header: 'cf-ray', vendor: 'Cloudflare' },
  { header: 'x-sucuri-id', vendor: 'Sucuri' },
  { header: 'x-sucuri-cache', vendor: 'Sucuri' },
  { header: 'x-iinfo', vendor: 'Imperva Incapsula' },
  { header: 'x-akamai-transformed', vendor: 'Akamai' },
];
