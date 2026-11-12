/** The effort of a fix, from its own shape. No rule is written yet, so no fix states one. */
import type { Fix } from '@crawlmouse/types/v2';
import type { FixRecord } from '../grade/effects.js';

export function effortOf(_fix: FixRecord): Fix['effort'] {
  return null;
}
