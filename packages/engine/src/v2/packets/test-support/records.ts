/** Detector records for the tests of what is written from a record: one of each family, detected. */
import type { ContentCheck, FixType } from '@crawlmouse/types/v2';
import type { AccessDetection } from '../../access/types.js';
import type { ContentDetection } from '../../content/aggregate.js';
import { CONTENT_CHECKS } from '../../content/checks.js';
import type { RenderedDetection, RenderedPage } from '../../detectors/rendered.js';
import type { Detection } from '../../detectors/types.js';

const FINGERPRINT = 'a'.repeat(16);

/** An edge rule blocking `crawler` on `matching` of the `of` pages it was judged on. */
export function accessRecord(
  crawler = 'GPTBot',
  extent: AccessDetection['extent'] = { matching: 4, of: 4 },
): AccessDetection {
  const pages = Array.from({ length: extent?.matching ?? 0 }, (_, i) => `https://a.test/p${i}`);
  return {
    type: 'edge_rule_blocks_crawler',
    fingerprint: FINGERPRINT,
    key: `edge:${crawler.toLowerCase()}`,
    crawler,
    group: 'ai_training',
    scored: false,
    state: 'detected',
    reason: null,
    measured: extent === null ? null : extent.matching / extent.of,
    extent,
    recommendation_class: 'confirmed_defect',
    confidence: 'likely',
    intent: null,
    opens_fix: true,
    affected_urls: pages,
    evidence: { access_test_ids: [], pages, causes: [], signatures: [] },
  };
}

/** The content check `check` failing on `failing` of the `of` decided pages of one template. */
export function contentRecord(
  check: ContentCheck,
  extent: ContentDetection['extent'] = { failing: 3, of: 10, unread: 0 },
): ContentDetection {
  const type = CONTENT_CHECKS[check].fix;
  if (type === null) throw new Error(`the check ${check} opens no fix`);
  return {
    type,
    check,
    fingerprint: FINGERPRINT,
    key: `${check}:/blog/{slug}`,
    template_key: '/blog/{slug}',
    state: 'detected',
    reason: null,
    measured: extent.of === 0 ? null : extent.failing / extent.of,
    extent,
    recommendation_class: 'best_practice',
    affected_urls: Array.from({ length: extent.failing }, (_, i) => `https://a.test/blog/${i}`),
  };
}

/** A structure detector's record of `type`, about one page. */
export function structureRecord(type: FixType): Detection {
  return {
    type,
    fingerprint: FINGERPRINT,
    key: `${type}:https://a.test/x`,
    state: 'detected',
    reason: null,
    page_gone: null,
    measured: null,
    conditions: [],
    affected_urls: ['https://a.test/x'],
    evidence: { pages: ['https://a.test/x'], edges: [] },
  };
}

/** A client-rendered template, detected from `pages`. */
export function renderedRecord(pages: RenderedPage[], measured: number | null): RenderedDetection {
  return {
    type: 'client_rendered_template',
    fingerprint: FINGERPRINT,
    key: 'rendered:/products/{handle}',
    template_key: '/products/{handle}',
    state: 'detected',
    reason: null,
    measured,
    extent: { pages: 40, graded: 40, rendered: pages.length },
    affected_urls: pages.map((p) => p.url),
    evidence: { pages },
  };
}
