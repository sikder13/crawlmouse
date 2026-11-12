/** The before and after rows of a fix, for the measures its record holds. None is written yet. */
import type { Fix } from '@crawlmouse/types/v2';
import type { FixRecord } from '../grade/effects.js';
import type { PacketFacts } from './types.js';

export function beforeAfterOf(_fix: FixRecord, _facts: PacketFacts): Fix['before_after'] {
  return [];
}
