/**
 * What the rendered-page detectors report: one record per template, from the pages of it the render
 * step measured (`PageResult.without_js`).
 */
import type { DetectionState } from '@crawlmouse/types/v2';

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
  /** The template's graded pages, and how many of them the render step measured. */
  extent: { pages: number; rendered: number };
  /** The template's graded pages, sorted: empty unless detected. */
  affected_urls: string[];
  /** The rendered pages the verdict rests on, sorted by URL. */
  evidence: { pages: RenderedPage[] };
}
