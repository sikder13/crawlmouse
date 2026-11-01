/**
 * Writes docs/specs/v2/16-structure-detectors.md. Run from the repository root:
 *   pnpm --filter @crawlmouse/engine exec tsx src/v2/detectors/write-spec.ts
 */
import { writeFileSync } from 'node:fs';
import { renderStructureSpec, SPEC_URL } from './spec.js';

writeFileSync(SPEC_URL, renderStructureSpec());
