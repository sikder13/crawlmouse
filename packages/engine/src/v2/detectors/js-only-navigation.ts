/**
 * The JS-only navigation detector: one record per template present in the check, from what the render
 * step found a page's script adds to its same-site links (render/links.ts `RenderLinks`, kept on the
 * render outcome, never on `PageResult`).
 *
 * The population, the presence rule, the deciding pages and the record for a template an awaiting fix
 * names with no present page are client_rendered_template's (detectors/rendered.ts). A deciding page
 * is evidence when it was measured (`without_js`) and its render outcome carries `links`: the render
 * step took the difference over both sides read whole, so an empty one shows the script adds no
 * same-site link, and a bounded one still counts every target. An outcome stored before links were
 * kept carries none, and its pages are not evidence. The verdict (`verdict`, shared):
 *
 *   detected       an evidence page exists, and each has a JS-only target
 *   not_detected   an evidence page exists, and none has
 *   indeterminate  `pages_disagree`: some have and some have not
 *                  `not_rendered`: no deciding page is evidence
 *                  `template_absent`: an awaiting fix names the template and it has no present page
 *
 * The evidence keeps each evidence page's JS-only target count (`js_only_count`, before any bound) and
 * its first MAX_JS_ONLY_TARGETS targets in sorted order.
 */
import type { DetectionState } from '@crawlmouse/types/v2';
import type { RenderLinks } from '../render/links.js';
import { fingerprintOf } from './fingerprint.js';
import {
  byText,
  decidingPages,
  presentTemplates,
  verdict,
  type RenderedContext,
  type RenderedDetection,
  type RenderedIndeterminateReason,
  type RenderedInputPage,
} from './rendered.js';
import { isGraded } from '../grade/technical-seo.js';

/** The most JS-only targets the evidence keeps a page. Our choice. */
export const MAX_JS_ONLY_TARGETS = 20;

/** The key prefix of a JS-only navigation fingerprint; the subject is the template key. */
export const JS_ONLY_KEY_PREFIX = 'jsnav';

/** One evidence page: how many of its rendered link targets its static HTML lacks, and the first. */
export interface JsOnlyPage {
  url: string;
  js_only_count: number;
  /** At most MAX_JS_ONLY_TARGETS, sorted. */
  js_only_targets: string[];
}

export interface JsOnlyDetection {
  type: 'js_only_navigation';
  /** `FingerprintSchema`: the hash of `key`. */
  fingerprint: string;
  key: string;
  template_key: string;
  state: DetectionState;
  /** Set exactly when `state` is `indeterminate`. */
  reason: RenderedIndeterminateReason | null;
  /** The template's present pages, how many are graded, and how many deciding pages are evidence. */
  extent: { pages: number; graded: number; rendered: number };
  /** The template's present pages, sorted: empty unless detected. */
  affected_urls: string[];
  /** The evidence pages, sorted by URL. */
  evidence: { pages: JsOnlyPage[] };
}

/** A record of either rendered-page detector: what the fix records of the `rendered` family hold. */
export type RenderedRecord = RenderedDetection | JsOnlyDetection;

export function detectJsOnlyNavigation(
  pages: readonly RenderedInputPage[],
  links: ReadonlyMap<string, RenderLinks>,
  context: RenderedContext = {},
): JsOnlyDetection[] {
  return presentTemplates(pages, context).map(([template_key, present]): JsOnlyDetection => {
    const evidence = decidingPages(present)
      .flatMap((p): JsOnlyPage[] => {
        const l = links.get(p.url);
        if (p.without_js === null || l === undefined) return [];
        const targets = [...l.js_only].sort(byText);
        return [
          {
            url: p.url,
            js_only_count: l.js_only_count,
            js_only_targets: targets.slice(0, MAX_JS_ONLY_TARGETS),
          },
        ];
      })
      .sort((a, b) => byText(a.url, b.url));
    const { state, reason } =
      present.length === 0
        ? { state: 'indeterminate' as const, reason: 'template_absent' as const }
        : verdict(evidence.length, evidence.filter((p) => p.js_only_count > 0).length);
    const key = `${JS_ONLY_KEY_PREFIX}:${template_key}`;
    return {
      type: 'js_only_navigation',
      fingerprint: fingerprintOf(key),
      key,
      template_key,
      state,
      reason,
      extent: {
        pages: present.length,
        graded: present.filter(isGraded).length,
        rendered: evidence.length,
      },
      affected_urls: state === 'detected' ? present.map((p) => p.url).sort(byText) : [],
      evidence: { pages: evidence },
    };
  });
}
