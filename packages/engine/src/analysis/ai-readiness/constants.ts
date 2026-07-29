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
export const EXCERPT_MAX_BYTES = 2000;

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

/**
 * CAP AT THE SOURCE. Every crawled string that enters `PageAiSignals` or `AiFinding` is bounded HERE,
 * once, at construction — not at persist, not at projection, not at mint. Downstream consumers inherit
 * bounded data; their own caps are defense-in-depth, never the defense.
 *
 * This replaces a design that capped COUNTS downstream while leaving the per-item string axis
 * unbounded. That failed five times and no count-based test caught it: measured `audits.ai_readiness`
 * at 99.76 MB (the count cap removed 0.4%), the Pro `whatAiSees` payload at 20.4 MB — 5x the defect it
 * was written to fix — and the FREE `homepageView` at ~5 MB, all from ~154 KB of gzipped attacker
 * response. The multiplier every time was a raw crawled `<title>`.
 *
 * THE BUDGETS ARE UTF-8 BYTES, not characters. They used to be code-unit caps while PostgREST sends
 * UTF-8, so the figure below was understated ~3x on non-Latin text: a plain Chinese-language page
 * measured 12 947 real bytes per `ai_signals` row against a "4.5 KB" claim, and a 500-page audit came
 * to 6.47 MB against a documented 1.2 MB. Measured again with byte budgets:
 *
 *   per page  : <= 8 760 B serialized `ai_signals`  (ASCII/CJK/astral 4.5 KB; quote-dense 8 757 B)
 *   500 pages : <= 4.4 MB      2000 pages: <= 17.6 MB   (and the insert is chunked besides)
 *
 * The quote/backslash figure is the one that matters and was missed twice: `"` and `\` are ordinary
 * crawled characters that `JSON.stringify` renders as TWO bytes each, so a page of them is ~1.95x the
 * ASCII figure. Both earlier estimates were derived from fixtures that varied the length and the
 * script but pinned the CHARACTER CLASS to `'X'` — character class is an axis too.
 *
 * 8 760 is DERIVED and then confirmed by a fixture, in that order. The previous "8.7 KB" was neither:
 * it was read off a fixture whose `@type` values were 60 quote chars against a 100-BYTE cap, so the
 * fixture measured 7 178 B, the true worst case was 8 757 B, and the shipped `x 2000 < 17 500 000`
 * assertion FAILED at the very shape it claimed to bound (17 512 000). No audit could fail — the insert
 * is chunked at 250 rows, ~2.2 MB per body — but the number the size argument rests on was wrong. The
 * sum, each field at its own cap:
 *   title 402 + excerpt 4 002 + jsonLd 4 121 (types 4 061) + pageClass 10 + frameworkMarker 8
 *   + booleans/keys/punctuation + counters (`mainTextChars` <= 8 digits, `h1Count` <= 7, both bounded
 *     by safe-fetch's 10 MB response cap)                                                     = 8 760
 * `csrSignals` is NOT additive with `excerpt`: it only populates below `MIN_MAIN_TEXT_CHARS`, so that
 * branch trades ~3 700 excerpt bytes for 183 and tops out at 5 231.
 *   per finding: title 200 + url 500 + text 500 <= 1.3 KB, x AI_PERSIST_MAX_FINDINGS
 *
 * Product consequence, stated plainly: a non-Latin page yields fewer CHARACTERS per excerpt than an
 * English one for the same budget. That is intended — the budget exists to bound what crosses the
 * wire, and the wire is bytes.
 *
 * NOT capped here, deliberately: `pages.title` and `links.anchor_text`. Those feed `isGenericAnchor`
 * and anchor diversity, i.e. the GRADE — bounding them is a §5 non-regression change tracked as FU-6.
 * The AI feature keeps its own bounded copy of the title rather than reaching for the grade path's.
 */
export const AI_TITLE_MAX_BYTES = 200;
export const AI_URL_MAX_BYTES = 500;
export const AI_TEXT_MAX_BYTES = 500;

/**
 * §5 JSON-LD `@type` collection bounds. The types list is attacker-controlled (any site can serve any
 * `<script type="application/ld+json">`) and is persisted verbatim into the `pages.ai_signals` jsonb
 * column, once per page. Unbounded, ONE page measured at 1.15 MB — against a migration that budgeted
 * "~2KB/page ⇒ ≤ ~1.2MB per 500-page audit". At that size a 500-page insert body is ~575 MB: OOM,
 * timeout or reject, i.e. a failed audit; and in the sub-fatal range it inflates 30-day storage with
 * attacker-chosen bytes against the ≤18%-MRR ceiling.
 *
 * FOUR axes, because bounding one leaves the product unbounded: how many types are kept, how long each
 * one is, how deep `@graph` nesting recurses, and how many nodes the walk visits at all (the last is
 * what stops a wide-but-shallow graph from costing O(n) work for a result capped at 20 anyway).
 */
export const JSON_LD_MAX_TYPES = 20;
export const JSON_LD_TYPE_MAX_BYTES = 100;
export const JSON_LD_MAX_DEPTH = 12;
export const JSON_LD_MAX_NODES = 5000;
/**
 * Budget for the boolean-only entity scan. Deliberately far larger than the storage budget: that walk
 * allocates nothing and short-circuits on the first hit, and `JSON.parse` — the expensive part — has
 * already run before it starts. Keeping it separate is what stops a hostile page's type volume from
 * starving the signal and producing a false `missing_entity_link`.
 */
export const JSON_LD_ENTITY_SCAN_MAX_NODES = 50_000;
/**
 * Depth bound for the same scan, and separate from the storage walk's for the same reason as the node
 * budget: sharing `JSON_LD_MAX_DEPTH` meant a legitimately deep `@graph` still starved the signal, so
 * check-before-cap would have removed only the type-cap route to a false finding, not the nesting one.
 * Each `@graph` level costs 2 (object → array), so this permits ~32 levels; still a bounded recursion.
 */
export const JSON_LD_ENTITY_SCAN_MAX_DEPTH = 64;

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
