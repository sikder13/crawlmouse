/**
 * Writes docs/specs/v2/11-type-contract.md. Run from the repository root:
 *   pnpm --filter @crawlmouse/types exec tsx src/v2/spec/write.ts
 */
import { writeFileSync } from 'node:fs';
import { loadFixtures, SPEC_URL } from './load.js';
import { renderContractSpec } from './render.js';

writeFileSync(SPEC_URL, renderContractSpec(loadFixtures()));
