/**
 * One page's `without_js`, from its two renders: the static side (scripts refused) and the rendered
 * side. A page whose rendered side has no words, or where either side is a challenge page, is not
 * measured: it has a reason, never a share.
 */
import type { PageResult } from '@crawlmouse/types/v2';
import { challengeIn } from './challenge.js';
import { jsTextState, textShare, type JsTextState } from './state.js';
import { renderLinks, type RenderLinks } from './links.js';
import { mainWords } from './words.js';

export type WithoutJs = NonNullable<PageResult['without_js']>;

export type PageMeasurement =
  | { measured: true; without_js: WithoutJs }
  | { measured: false; reason: 'challenged' | 'nothing_rendered' };

/**
 * Everything a page's two renders are read for: each side's words, whether either side is a challenge
 * page, and the links only the rendered side has (null when they could not be read). Pure and
 * synchronous, so the worker's reader thread can run it under its deadline (`@crawlmouse/engine/worker`).
 */
export interface RenderedReading {
  raw_words: number;
  rendered_words: number;
  challenged: boolean;
  links: RenderLinks | null;
}

export function readRendered(
  staticHtml: string,
  renderedHtml: string,
  pageUrl: string,
): RenderedReading {
  const raw_words = mainWords(staticHtml);
  const rendered_words = mainWords(renderedHtml);
  const challenged = challengeIn(staticHtml) || challengeIn(renderedHtml);
  let links: RenderLinks | null;
  try {
    links = renderLinks(staticHtml, renderedHtml, pageUrl);
  } catch {
    links = null;
  }
  return { raw_words, rendered_words, challenged, links };
}

/** A page's measurement from what its two renders read as. */
export function measureReading(
  r: Pick<RenderedReading, 'raw_words' | 'rendered_words' | 'challenged'>,
  previous: JsTextState | null,
): PageMeasurement {
  if (r.challenged) return { measured: false, reason: 'challenged' };
  const { raw_words, rendered_words } = r;
  const text_share = textShare(raw_words, rendered_words);
  if (text_share === null) return { measured: false, reason: 'nothing_rendered' };
  return {
    measured: true,
    without_js: {
      raw_words,
      rendered_words,
      text_share,
      state: jsTextState(text_share, previous),
    },
  };
}

export function measurePage(input: {
  staticHtml: string;
  renderedHtml: string;
  previous: JsTextState | null;
}): PageMeasurement {
  const raw_words = mainWords(input.staticHtml);
  const rendered_words = mainWords(input.renderedHtml);
  const challenged = challengeIn(input.staticHtml) || challengeIn(input.renderedHtml);
  return measureReading({ raw_words, rendered_words, challenged }, input.previous);
}
