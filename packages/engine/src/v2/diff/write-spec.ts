/**
 * Writes docs/specs/v2/19-diff-lifecycle.md. Run from the repository root:
 *   pnpm --filter @crawlmouse/engine exec tsx src/v2/diff/write-spec.ts
 */
import { writeFileSync } from 'node:fs';
import { renderDiffSpec, SPEC_URL } from './spec.js';

writeFileSync(SPEC_URL, renderDiffSpec());
