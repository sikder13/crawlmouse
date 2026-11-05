/**
 * A page's share of words served without JavaScript, and the state it puts the page in.
 *
 * Two renders of one page differ by a few words, so the line a fix opens on carries hysteresis
 * (DECISION-LOG B7): a page is an empty shell below EMPTY_SHELL_BELOW, and once it is one it stays one
 * until its share rises above EMPTY_SHELL_LEAVES_ABOVE. The partial/readable line has none.
 */
import type { PageResult } from '@crawlmouse/types/v2';

export type JsTextState = NonNullable<PageResult['without_js']>['state'];

export const EMPTY_SHELL_BELOW = 0.3;
export const EMPTY_SHELL_LEAVES_ABOVE = 0.45;
export const READABLE_FROM = 0.8;

/**
 * Static words over rendered words, at most 1; null when the rendered side has no words. A static side
 * with more words than the rendered one is clamped to 1. A script that removes text is one cause; a
 * rendered side that was counted short is another, and the clamp reads it as readable all the same.
 */
export function textShare(rawWords: number, renderedWords: number): number | null {
  if (renderedWords === 0) return null;
  return Math.min(1, rawWords / renderedWords);
}

/** `previous` is this page's state in the previous check, or null when it was not measured there. */
export function jsTextState(share: number, previous: JsTextState | null): JsTextState {
  const shell =
    previous === 'empty_shell' ? share <= EMPTY_SHELL_LEAVES_ABOVE : share < EMPTY_SHELL_BELOW;
  if (shell) return 'empty_shell';
  return share >= READABLE_FROM ? 'readable' : 'partial';
}
