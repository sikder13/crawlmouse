/**
 * Writes docs/specs/v2/14-render.md. Run from the repository root:
 *   pnpm --filter @crawlmouse/engine exec tsx src/v2/render/write-spec.ts
 */
import { writeFileSync } from 'node:fs';
import { renderRenderSpec, SPEC_URL } from './spec.js';

writeFileSync(SPEC_URL, renderRenderSpec());
