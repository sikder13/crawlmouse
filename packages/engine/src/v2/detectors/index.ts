/**
 * The structure detectors (CC-16): each judges one fix type on one check and returns a detection
 * record per fingerprint. CC-17 turns the records into the diff's `DetectorOutcome`s.
 */
import { detectCanonicalMismatch } from './canonical-mismatch.js';
import { detectDeepPages } from './deep-pages.js';
import { detectDuplicatePagination } from './duplicate-pagination.js';
import type { StructureFixType } from './fingerprint.js';
import { detectGenericAnchors } from './generic-anchors.js';
import { detectHreflangGaps } from './hreflang-gaps.js';
import { detectOrphans } from './orphans.js';
import { detectRedirectChains } from './redirect-chains.js';
import { byKey } from './scope.js';
import type { Detection, DetectorInput } from './types.js';

export const DETECTORS: readonly {
  type: StructureFixType;
  detect: (input: DetectorInput) => Detection[];
}[] = [
  { type: 'orphan_pages', detect: detectOrphans },
  { type: 'deep_pages', detect: detectDeepPages },
  { type: 'generic_anchor_text', detect: detectGenericAnchors },
  { type: 'redirect_chain', detect: detectRedirectChains },
  { type: 'duplicate_pagination', detect: detectDuplicatePagination },
  { type: 'canonical_mismatch', detect: detectCanonicalMismatch },
  { type: 'hreflang_gap', detect: detectHreflangGaps },
];

/** Every structure detector's records for one check, sorted by fix type, then key. */
export function detectStructure(input: DetectorInput): Detection[] {
  return DETECTORS.flatMap((d) => d.detect(input)).sort(byKey);
}

export type {
  Condition,
  Detection,
  DetectorInput,
  HreflangLink,
  IndeterminateReason,
  PageFacts,
  RedirectHops,
} from './types.js';
export { fingerprintKey, fingerprintOf, KEY_PREFIX, type StructureFixType } from './fingerprint.js';
