/**
 * Writes docs/specs/v2/17-content-and-grade.md. Run from the repository root:
 *   pnpm --filter @crawlmouse/engine exec tsx src/v2/grade/write-spec.ts
 */
import { writeFileSync } from 'node:fs';
import { renderGradeSpec, SPEC_URL } from './spec.js';

writeFileSync(SPEC_URL, renderGradeSpec());
