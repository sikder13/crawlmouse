/**
 * The rendered-page detector: one record per template present in the check, from the pages of it the
 * render step measured (`PageResult.without_js`).
 *
 * A template is present when it has a graded page (`isGraded`) or an empty-root page: a crawled page
 * the empty-root rule holds for (render/empty-root.ts `emptyRoot`; the caller passes their URLs). The
 * present pages are the population: `extent.pages` counts them and a detection affects them.
 *
 * The verdict reads the deciding renders. For a template with a graded page they are the rendered
 * graded pages, and nothing else: an empty-root page is rendered because its static root is empty, so
 * its render would read as a shell whatever the graded pages serve, and the verdict, `measured`, the
 * evidence and `extent.rendered` are what they were before empty-root pages were rendered. For a
 * template with no graded page they are its rendered empty-root pages (render/run.ts, the empty-root
 * phase). `client_rendered_template` reads the render step's own state for each page (render/state.ts,
 * which carries the hysteresis), so there is one definition of an empty shell:
 *
 *   detected       a deciding render exists, and each is `empty_shell`
 *   not_detected   a deciding render exists, and none is `empty_shell`
 *   indeterminate  `pages_disagree`: some deciding renders are `empty_shell` and some are not
 *                  `not_rendered`: there is no deciding render
 *
 * So a template whose graded pages were not rendered is `not_rendered`, however its empty-root pages
 * rendered.
 *
 * A template an awaiting client-rendered fix names (the caller passes them) and that has no present
 * page gets a record too: `indeterminate`, reason `template_absent`, with no page. So the fix is
 * measured again on every check rather than left with no outcome; the lifecycle's rule for an
 * indeterminate record decides what that does to it (diff/lifecycle.ts).
 *
 * `js_only_navigation` has its own detector, over the same population and deciding pages
 * (detectors/js-only-navigation.ts).
 */
import type { DetectionState, PageResult } from '@crawlmouse/types/v2';
import { median } from '../grade/numbers.js';
import { isGraded } from '../grade/technical-seo.js';
import { fingerprintOf } from './fingerprint.js';

/** Why a rendered-page detector could not decide. */
export const RENDERED_INDETERMINATE_REASONS = [
  'not_rendered',
  'pages_disagree',
  'template_absent',
] as const;
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
  type: 'client_rendered_template';
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
  /**
   * The template's present pages, how many of them are graded, and how many deciding renders there
   * were (rendered graded pages, or, with no graded page, rendered empty-root pages).
   */
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

export const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The verdict over a template's deciding pages: `found` of the `deciding` pages carry the finding.
 * Shared with detectors/js-only-navigation.ts.
 */
export function verdict(
  deciding: number,
  found: number,
): Pick<RenderedDetection, 'state' | 'reason'> {
  if (deciding === 0) return { state: 'indeterminate', reason: 'not_rendered' };
  if (found === deciding) return { state: 'detected', reason: null };
  if (found === 0) return { state: 'not_detected', reason: null };
  return { state: 'indeterminate', reason: 'pages_disagree' };
}

/** What the detector reads besides the pages. */
export interface RenderedContext {
  /** The URLs of the crawled empty-root pages (build/plan.ts `emptyRootUrls`); none when left out. */
  emptyRoots?: ReadonlySet<string>;
  /**
   * The templates the site's awaiting client-rendered fixes name (build/plan.ts
   * `awaitingShellTemplates`); none when left out.
   */
  openTemplates?: readonly string[];
}

/**
 * Each template present in the check, with its present pages (graded or empty-root), and each template
 * an open fix names with none, in template-key order. Shared with detectors/js-only-navigation.ts.
 */
export function presentTemplates<P extends RenderedInputPage>(
  pages: readonly P[],
  { emptyRoots = new Set(), openTemplates = [] }: RenderedContext = {},
): Array<[string, P[]]> {
  const templates = new Map<string, P[]>();
  for (const p of pages.filter((p) => isGraded(p) || emptyRoots.has(p.url))) {
    templates.set(p.template_key, [...(templates.get(p.template_key) ?? []), p]);
  }
  for (const t of openTemplates) if (!templates.has(t)) templates.set(t, []);
  return [...templates].sort(([a], [b]) => byText(a, b));
}

/**
 * The pages whose renders decide a present template's verdict: its graded pages when it has any, its
 * empty-root pages otherwise. Shared with detectors/js-only-navigation.ts.
 */
export const decidingPages = <P extends RenderedInputPage>(present: readonly P[]): readonly P[] => {
  const graded = present.filter(isGraded);
  return graded.length > 0 ? graded : present;
};

/**
 * One `client_rendered_template` record per template present in the check, and per template an open
 * fix names, in template-key order.
 */
export function detectRendered(
  pages: readonly RenderedInputPage[],
  context: RenderedContext = {},
): RenderedDetection[] {
  return presentTemplates(pages, context).map(([template_key, present]): RenderedDetection => {
    const graded = present.filter(isGraded);
    const rendered = decidingPages(present)
      .flatMap((p) => (p.without_js ? [{ url: p.url, ...p.without_js }] : []))
      .sort((a, b) => byText(a.url, b.url));
    const shells = rendered.filter((p) => p.state === 'empty_shell').length;
    const { state, reason } =
      present.length === 0
        ? { state: 'indeterminate' as const, reason: 'template_absent' as const }
        : verdict(rendered.length, shells);
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
        graded: graded.length,
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
