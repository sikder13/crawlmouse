/**
 * One page's `without_js`, from its two renders: the static side (scripts refused) and the rendered
 * side. A page whose rendered side has no words, or where either side is a challenge page, is not
 * measured: it has a reason, never a share.
 */
import type { PageResult } from '@crawlmouse/types/v2';
import { challengeIn } from './challenge.js';
import { jsTextState, textShare, type JsTextState } from './state.js';
import { mainWords } from './words.js';

export type WithoutJs = NonNullable<PageResult['without_js']>;

export type PageMeasurement =
  | { measured: true; without_js: WithoutJs }
  | { measured: false; reason: 'challenged' | 'nothing_rendered' };

export function measurePage(input: {
  staticHtml: string;
  renderedHtml: string;
  previous: JsTextState | null;
}): PageMeasurement {
  const raw_words = mainWords(input.staticHtml);
  const rendered_words = mainWords(input.renderedHtml);
  if (challengeIn(input.staticHtml) || challengeIn(input.renderedHtml)) {
    return { measured: false, reason: 'challenged' };
  }
  const text_share = textShare(raw_words, rendered_words);
  if (text_share === null) return { measured: false, reason: 'nothing_rendered' };
  return {
    measured: true,
    without_js: {
      raw_words,
      rendered_words,
      text_share,
      state: jsTextState(text_share, input.previous),
    },
  };
}
