import type {
  AiReadinessScore,
  AiFinding,
  AiFindingKind,
  PageAiSignals,
  LlmsTxtStatus,
  Confidence,
} from '@crawlmouse/types';
import type { ParsedRobots } from '../../robots.js';
import { MAX_HEALTHY_DEPTH } from '../../constants.js';
import {
  AI_COMPONENT_WEIGHTS,
  PAGE_CLASS_SUBSCORE,
  AI_BAND_READY_MIN,
  AI_BAND_PARTIAL_MIN,
  LEGIBILITY_PERPAGE_WEIGHT,
  LEGIBILITY_ENTITY_WEIGHT,
  AI_EVIDENCE_AS_OF,
  AI_TITLE_MAX_CHARS,
  AI_URL_MAX_CHARS,
  AI_TEXT_MAX_CHARS,
} from './constants.js';
import { toPersistableText } from '../../text-safety.js';
import { buildAccessMatrix } from './access-matrix.js';
import { stableFindingId } from './finding-id.js';

/** A gradeable (200) page that carries extracted AI signals — the eligible unit for scoring. */
export interface AiReadinessPage {
  url: string;
  title: string | null;
  aiSignals: PageAiSignals;
}

export interface AiReadinessInput {
  pages: AiReadinessPage[]; // gradeable pages WITH aiSignals (the eligible set)
  depths: Map<string, number>;
  orphanSet: Set<string>; // filtered orphans (empty/ignored on a JS-rendered site)
  jsRendered: boolean;
  robots: ParsedRobots | null;
  wafDetected: boolean;
  wafNote: string | null;
  llmsTxt: LlmsTxtStatus;
  confidence: Confidence;
  partial: boolean;
  homepageUrl: string;
}

type Evidence = AiFinding['evidence'];

function finding(
  kind: AiFindingKind,
  severity: AiFinding['severity'],
  evidence: Evidence,
  target: { url: string; title: string | null } | null,
  plainLanguage: string,
  idKey?: string | null,
): AiFinding {
  // Site-level findings (target null) that recur per subject — one per blocked BOT — must still get a
  // UNIQUE, stable id, else every blocked bot of a class collides on hash(kind + '') and SPEC 06 diffing
  // + Stage-5 id-keyed rendering break. `idKey` (e.g. the bot token) disambiguates while targetUrl stays null.
  // CAP AT THE SOURCE. Every crawled string on an AiFinding is bounded HERE, once, where the finding
  // is constructed — not at persist, not at projection, not at mint. `targetTitle` is a raw crawled
  // <title> and is repeated once per finding, so leaving it unbounded made a 500-finding cap serialise
  // to 99.76 MB; the cap removed 0.4% of it. Downstream caps are defense-in-depth, never the defense.
  return {
    id: stableFindingId(kind, idKey ?? target?.url ?? null),
    kind,
    severity,
    targetUrl: target?.url == null ? null : toPersistableText(target.url, AI_URL_MAX_CHARS),
    targetTitle: target?.title == null ? null : toPersistableText(target.title, AI_TITLE_MAX_CHARS),
    plainLanguage: toPersistableText(plainLanguage, AI_TEXT_MAX_CHARS),
    evidence,
  };
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return '/';
  }
}

/**
 * §7 — assemble the sibling AI-readiness score from per-page signals + the already-computed graph. Pure,
 * deterministic (R1). Returns `null` when there are no eligible pages with signals (Amendment §2 null-
 * assembly rule) — the feature is hidden end-to-end rather than scored over missing data.
 */
export function assembleAiReadiness(input: AiReadinessInput): AiReadinessScore | null {
  const { pages } = input;
  if (pages.length === 0) return null;

  const findings: AiFinding[] = [];

  // ── Component 2: Content Without JavaScript (§4.3), the flagship. Mean per-class subscore. ──
  let contentSum = 0;
  for (const p of pages) {
    const cls = p.aiSignals.pageClass;
    contentSum += PAGE_CLASS_SUBSCORE[cls];
    const marker = p.aiSignals.frameworkMarker ? ` (${p.aiSignals.frameworkMarker} detected)` : '';
    if (cls === 'js_blind') {
      findings.push(
        finding('js_blind_page', 'high', 'strong', p, `This page renders its content with JavaScript${marker}, so an AI crawler that only reads static HTML sees an empty page. Server-render it so the text is in the initial HTML.`),
      );
    } else if (cls === 'partial') {
      findings.push(
        finding('partial_js_page', 'medium', 'strong', p, `Only part of this page's content is in the static HTML${marker}; the rest loads with JavaScript and is invisible to non-rendering AI crawlers.`),
      );
    } else if (cls === 'thin') {
      // §4.3: thin scores 1.0 (no JS problem) but gets a separate INFO finding so the ledger explains why.
      findings.push(
        finding('thin_page', 'info', 'strong', p, 'This page has very little text. That is fine for a contact or landing page, but if it should carry substance, put that content in the static HTML.'),
      );
    }
  }
  const contentWithoutJs = contentSum / pages.length;

  // ── Component 3: Machine Legibility (§5). Per-page checks (excluding js_blind from the denominator)
  // blended with the homepage entity sub-signal. ──
  const legibilityPages = pages.filter((p) => p.aiSignals.pageClass !== 'js_blind');
  let legSum = 0;
  for (const p of legibilityPages) {
    const s = p.aiSignals;
    const checks = [
      s.hasTitle,
      s.hasMetaDescription,
      s.h1Count === 1,
      !s.headingLevelsSkipped,
      s.hasMainLandmark,
      s.jsonLd.present && s.jsonLd.valid,
    ];
    legSum += checks.filter(Boolean).length / checks.length;
    if (s.jsonLd.present && !s.jsonLd.valid) {
      findings.push(finding('invalid_structured_data', 'medium', 'contested', p, 'This page has JSON-LD structured data, but it is malformed and cannot be parsed — machines will ignore it.'));
    } else if (!s.jsonLd.present) {
      findings.push(finding('missing_structured_data', 'info', 'contested', p, 'This page has no JSON-LD structured data. Schema helps some assistants understand the page (evidence is mixed; low risk to add).'));
    }
    if (s.h1Count !== 1 || s.headingLevelsSkipped) {
      findings.push(finding('heading_structure', 'medium', 'moderate', p, s.h1Count !== 1 ? `This page has ${s.h1Count} H1 headings (a clear outline uses exactly one).` : 'This page skips heading levels (e.g. H1 → H3), which weakens the machine-readable outline.'));
    }
    if (!s.hasTitle || !s.hasMetaDescription) {
      const missing = !s.hasTitle && !s.hasMetaDescription ? 'title and meta description' : !s.hasTitle ? 'title' : 'meta description';
      findings.push(finding('missing_metadata', 'medium', 'moderate', p, `This page is missing its ${missing} — a basic signal every crawler reads.`));
    }
  }
  const perPageLegibility = legibilityPages.length === 0 ? 0 : legSum / legibilityPages.length;
  // Homepage entity sub-signal: the homepage declares an Organization/WebSite entity via JSON-LD. (v1
  // proxy for §5's sameAs "entity connection"; the sameAs refinement is a Stage-5 fixture-tunable follow-up.)
  const homepage = pages.find((p) => p.url === input.homepageUrl) ?? pages[0]!;
  // Read the BOOLEAN, never the capped `types` array. `hasEntityType` is decided by its own scan
  // before any storage cap exists (see legibility.ts), so a schema-rich homepage whose Organization
  // falls past the 20-type cap is still recognised. Deriving this from `types` made a storage cap
  // change the score and emit a factually false `missing_entity_link` (measured: 94 → 91).
  const homepageEntity = homepage.aiSignals.jsonLd.present && homepage.aiSignals.jsonLd.hasEntityType;
  if (!homepageEntity) {
    findings.push(finding('missing_entity_link', 'info', 'moderate', null, 'The homepage does not declare an Organization or WebSite entity in JSON-LD, so assistants have no structured anchor for who this site is.'));
  }
  const machineLegibility = LEGIBILITY_PERPAGE_WEIGHT * perPageLegibility + LEGIBILITY_ENTITY_WEIGHT * (homepageEntity ? 1 : 0);

  // ── Component 4: Retrieval Path (§6). Over readable/thin pages, fraction non-orphan AND depth ≤ 3.
  // On a JS-rendered site the orphan signal is suppressed → compute on a depth-only basis. ──
  const retrievalPages = pages.filter((p) => p.aiSignals.pageClass === 'readable' || p.aiSignals.pageClass === 'thin');
  const retrievalPathBasis: 'full' | 'depth_only' = input.jsRendered ? 'depth_only' : 'full';
  let good = 0;
  for (const p of retrievalPages) {
    const depth = input.depths.get(p.url);
    const shallow = depth !== undefined && depth <= MAX_HEALTHY_DEPTH;
    const orphan = !input.jsRendered && input.orphanSet.has(p.url);
    if (shallow && !orphan) good += 1;
    if (orphan) {
      findings.push(finding('readable_but_orphaned', 'high', 'strong', p, 'This page is readable by AI crawlers, but nothing links to it — so a crawler that follows links from your homepage will never reach it.'));
    } else if (!shallow) {
      findings.push(finding('readable_but_deep', 'medium', 'strong', p, `This readable page sits ${depth === undefined ? 'unreachably deep' : `${depth} clicks`} from the homepage; content buried past depth ${MAX_HEALTHY_DEPTH} is rarely crawled.`));
    }
  }
  // Empty readable/thin set (e.g. an all-`partial` site): reachability of readable content is UNMEASURABLE
  // — score it NEUTRAL (0.5), never 1.0 (which would award the full 15 points precisely when there is no
  // readable content to reach, inflating the band). Legibility's all-js_blind empty set stays 0 by contrast
  // (the pages ARE unreadable, so their legibility is genuinely 0 — and content already scored that; this
  // keeps a shell honestly `at_risk` rather than rewarding it). The asymmetry is intentional.
  const retrievalPath = retrievalPages.length === 0 ? 0.5 : good / retrievalPages.length;

  // ── Component 1: AI Crawler Access (§3). ──
  const { matrix, accessSubscore } = buildAccessMatrix(input.robots, pages.map((p) => pathOf(p.url)), input.wafDetected, input.wafNote);
  for (const b of matrix.bots) {
    if (b.allowedPageRatio >= 1) continue;
    const pct = Math.round(b.allowedPageRatio * 100);
    if (b.botClass === 'retrieval') {
      findings.push(finding('retrieval_bot_blocked', 'high', 'strong', null, `${b.operator}'s ${b.token} can reach only ${pct}% of your pages — blocking a search/citation crawler costs you visibility in its answers.`, b.token));
    } else if (b.botClass === 'training') {
      findings.push(finding('training_bot_blocked', 'info', 'strong', null, `${b.operator}'s ${b.token} (${b.botClass}) can reach ${pct}% of your pages. Blocking a training crawler is a legitimate choice and does not affect search citations.`, b.token));
    }
  }

  // ── llms.txt (§8), informational, ZERO weight. ──
  if (!input.llmsTxt.present) {
    findings.push(finding('llms_txt_absent', 'info', 'informational', null, `No llms.txt file was found. ${input.llmsTxt.note}`));
  }

  // ── Score assembly (§7). ──
  const w = AI_COMPONENT_WEIGHTS;
  const raw =
    (w.access * accessSubscore + w.contentWithoutJs * contentWithoutJs + w.machineLegibility * machineLegibility + w.retrievalPath * retrievalPath) /
    (w.access + w.contentWithoutJs + w.machineLegibility + w.retrievalPath);
  const score = Math.round(raw * 100);
  const band: AiReadinessScore['band'] = score >= AI_BAND_READY_MIN ? 'ready' : score >= AI_BAND_PARTIAL_MIN ? 'partial' : 'at_risk';
  const isEstimate = input.partial || input.confidence !== 'high';

  return {
    score,
    band,
    components: {
      access: { score: accessSubscore, weight: 25 },
      contentWithoutJs: { score: contentWithoutJs, weight: 40 },
      machineLegibility: { score: machineLegibility, weight: 20 },
      retrievalPath: { score: retrievalPath, weight: 15 },
    },
    confidence: input.confidence,
    isEstimate,
    basis: { pagesAnalyzed: pages.length, siteJsRendered: input.jsRendered, retrievalPathBasis },
    findings,
    // Stamped HERE, where the true count is known. The persistence layer caps `findings` but leaves
    // this alone, so "showing N of M" stays honest all the way through to the client.
    totalFindings: findings.length,
    // Bounded at the source for the same reason as the findings, even though both currently come from
    // static registries: nothing should have to re-derive which of these strings is crawled-adjacent.
    accessMatrix: {
      ...matrix,
      bots: matrix.bots.map((b) => ({ ...b, note: toPersistableText(b.note, AI_TEXT_MAX_CHARS) })),
      wafNote: matrix.wafNote == null ? null : toPersistableText(matrix.wafNote, AI_TEXT_MAX_CHARS),
    },
    llmsTxt: { ...input.llmsTxt, note: toPersistableText(input.llmsTxt.note, AI_TEXT_MAX_CHARS) },
    asOf: AI_EVIDENCE_AS_OF,
  };
}
