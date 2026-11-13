/**
 * The rendered-page detector: one record per template present in the check, from the pages of it the
 * render step measured (`PageResult.without_js`).
 *
 * A template is present when it has a graded page (`isGraded`) or an empty-root page: a crawled page
 * the empty-root rule holds for (render/empty-root.ts `emptyRoot`; the caller passes their URLs). The
 * present pages are the population: `extent.pages` counts them and a detection affects them. The
 * verdict reads the rendered pages among them, whether the graded phase or the empty-root phase
 * rendered them (render/run.ts). `client_rendered_template` reads the render step's own state for each
 * page (render/state.ts, which carries the hysteresis), so there is one definition of an empty shell:
 *
 *   detected       a page of the template was rendered, and each rendered page is `empty_shell`
 *   not_detected   a page was rendered, and none is `empty_shell`
 *   indeterminate  `pages_disagree`: some rendered pages are `empty_shell` and some are not
 *                  `not_rendered`: no page of the template was rendered
 *
 * A template whose graded pages render with text and whose empty-root pages render as shells is
 * `pages_disagree`.
 *
 * `js_only_navigation` has no detector: the render step keeps word counts and no link.
 */
import type { DetectionState, PageResult } from '@crawlmouse/types/v2';
import { median } from '../grade/numbers.js';
import { isGraded } from '../grade/technical-seo.js';
import { fingerprintOf } from './fingerprint.js';

export type RenderedFixType = 'client_rendered_template' | 'js_only_navigation';

/** Why a rendered-page detector could not decide. */
export const RENDERED_INDETERMINATE_REASONS = ['not_rendered', 'pages_disagree'] as const;
export type RenderedIndeterminateReason = (typeof RENDERED_INDETERMINATE_REASONS)[number];

/** One rendered page of the template, as the render step measured it. */
export interface RenderedPage {
  url: string;
  raw_words: number;
  rendered_words: number;
  text_share: number;
}

/** One rendered-page detector's verdict on one template. */
export interface RenderedDetection {
  type: RenderedFixType;
  /** `FingerprintSchema`: the hash of `key`. */
  fingerprint: string;
  /** The readable key the fingerprint hashes. */
  key: string;
  template_key: string;
  state: DetectionState;
  /** Set exactly when `state` is `indeterminate`. */
  reason: RenderedIndeterminateReason | null;
  /** The median `text_share` of the template's rendered pages; null when none was rendered. */
  measured: number | null;
  /** The template's present pages, how many of them are graded, and how many the render step measured. */
  extent: { pages: number; graded: number; rendered: number };
  /** The template's present pages, sorted: empty unless detected. */
  affected_urls: string[];
  /** The rendered pages the verdict rests on, sorted by URL. */
  evidence: { pages: RenderedPage[] };
}

/** What the detector reads of a page. */
export type RenderedInputPage = Pick<
  PageResult,
  'url' | 'template_key' | 'kind' | 'status_code' | 'is_html' | 'without_js'
>;

/** The key prefix of a client-rendered template's fingerprint; the subject is the template key. */
export const SHELL_KEY_PREFIX = 'shell';

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function verdict(rendered: number, shells: number): Pick<RenderedDetection, 'state' | 'reason'> {
  if (rendered === 0) return { state: 'indeterminate', reason: 'not_rendered' };
  if (shells === rendered) return { state: 'detected', reason: null };
  if (shells === 0) return { state: 'not_detected', reason: null };
  return { state: 'indeterminate', reason: 'pages_disagree' };
}

/** What the detector reads besides the pages. */
export interface RenderedContext {
  /** The URLs of the crawled empty-root pages (build/plan.ts `emptyRootUrls`); none when left out. */
  emptyRoots?: ReadonlySet<string>;
}

/** One `client_rendered_template` record per template present in the check, in template-key order. */
export function detectRendered(
  pages: readonly RenderedInputPage[],
  { emptyRoots = new Set() }: RenderedContext = {},
): RenderedDetection[] {
  const templates = new Map<string, RenderedInputPage[]>();
  for (const p of pages.filter((p) => isGraded(p) || emptyRoots.has(p.url))) {
    templates.set(p.template_key, [...(templates.get(p.template_key) ?? []), p]);
  }
  return [...templates]
    .sort(([a], [b]) => byText(a, b))
    .map(([template_key, present]): RenderedDetection => {
      const rendered = present
        .flatMap((p) => (p.without_js ? [{ url: p.url, ...p.without_js }] : []))
        .sort((a, b) => byText(a.url, b.url));
      const shells = rendered.filter((p) => p.state === 'empty_shell').length;
      const { state, reason } = verdict(rendered.length, shells);
      const key = `${SHELL_KEY_PREFIX}:${template_key}`;
      return {
        type: 'client_rendered_template',
        fingerprint: fingerprintOf(key),
        key,
        template_key,
        state,
        reason,
        measured: rendered.length === 0 ? null : median(rendered.map((p) => p.text_share)),
        extent: {
          pages: present.length,
          graded: present.filter(isGraded).length,
          rendered: rendered.length,
        },
        affected_urls: state === 'detected' ? present.map((p) => p.url).sort(byText) : [],
        evidence: {
          pages: rendered.map(({ url, raw_words, rendered_words, text_share }) => ({
            url,
            raw_words,
            rendered_words,
            text_share,
          })),
        },
      };
    });
}
