/**
 * Writes docs/specs/v2/20a-check-builder.md. Run from the repository root:
 *   pnpm --filter @crawlmouse/engine exec tsx src/v2/build/write-spec.ts
 */
import { writeFileSync } from 'node:fs';
import { renderBuildSpec, SPEC_URL } from './spec.js';

writeFileSync(SPEC_URL, renderBuildSpec());
