// Writes docs/specs/v2/21-design-system.md and docs/specs/v2/22-audit-flow.md from the code. Run
// from apps/web:
//   pnpm --filter @crawlmouse/web exec tsx __tests__/v2/generate-spec.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SPEC_PATH, buildSpec } from './spec/build-spec';
import { SPEC_22_PATH, buildSpec22 } from './spec/build-spec-22';

for (const [path, build] of [
  [SPEC_PATH, buildSpec],
  [SPEC_22_PATH, buildSpec22],
] as const) {
  const spec = await build();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, spec);
  console.log(`wrote ${path}`);
}
