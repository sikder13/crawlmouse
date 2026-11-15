/**
 * What the D8 wording rule (`banned-phrases.ts`) excuses, as data. Read by
 * `__tests__/seo-banned-phrases.test.tsx`, which fails on a match not listed here and on an entry
 * that does not fire in a build it names, so an entry is deleted once its page no longer says it.
 *
 * An entry is keyed by page and phrase id: it excuses every match of that phrase on that page.
 * `(layout)` is the root layout's metadata and Organization block, which every page carries.
 */
import type { Build } from './page-exceptions';

export interface PhraseException {
  path: string;
  /** A `BannedPhrase.id`. */
  phrase: string;
  builds: readonly Build[];
  reason: string;
}

export const PHRASE_EXCEPTIONS: readonly PhraseException[] = [];
