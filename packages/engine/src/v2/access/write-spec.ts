/**
 * Writes docs/specs/v2/15-access-detectors.md. Run from the repository root:
 *   pnpm --filter @crawlmouse/engine exec tsx src/v2/access/write-spec.ts
 */
import { writeFileSync } from 'node:fs';
import { renderAccessSpec, SPEC_URL } from './spec.js';

writeFileSync(SPEC_URL, renderAccessSpec());
