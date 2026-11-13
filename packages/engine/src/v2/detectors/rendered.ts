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
 * `js_only_navigation` has no detector: the render step keeps word counts and no link.
 */
import type { DetectionState, PageResult } from '@crawlmouse/types/v2';
import { median } from '../grade/numbers.js';
import { isGraded } from '../grade/technical-seo.js';
import { fingerprintOf } from './fingerprint.js';

export type RenderedFixType = 'client_rendered_template' | 'js_only_navigation';

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
  /**
   * The templates the site's awaiting client-rendered fixes name (build/plan.ts
   * `awaitingShellTemplates`); none when left out.
   */
  openTemplates?: readonly string[];
}

/**
 * One `client_rendered_template` record per template present in the check, and per template an open
 * fix names, in template-key order.
 */
export function detectRendered(
  pages: readonly RenderedInputPage[],
  { emptyRoots = new Set(), openTemplates = [] }: RenderedContext = {},
): RenderedDetection[] {
  const templates = new Map<string, RenderedInputPage[]>();
  for (const p of pages.filter((p) => isGraded(p) || emptyRoots.has(p.url))) {
    templates.set(p.template_key, [...(templates.get(p.template_key) ?? []), p]);
  }
  for (const t of openTemplates) if (!templates.has(t)) templates.set(t, []);
  return [...templates]
    .sort(([a], [b]) => byText(a, b))
    .map(([template_key, present]): RenderedDetection => {
      const graded = present.filter(isGraded);
      const rendered = (graded.length > 0 ? graded : present)
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
