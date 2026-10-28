// Writes docs/specs/v2/21-design-system.md from the code. Run from apps/web:
//   pnpm --filter @crawlmouse/web exec tsx __tests__/v2/generate-spec.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SPEC_PATH, buildSpec } from './spec/build-spec';

const spec = await buildSpec();
mkdirSync(dirname(SPEC_PATH), { recursive: true });
writeFileSync(SPEC_PATH, spec);
console.log(`wrote ${SPEC_PATH}`);
