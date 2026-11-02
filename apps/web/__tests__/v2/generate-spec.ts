// Writes docs/specs/v2/21-design-system.md, 22-audit-flow.md, 23-segments.md and 24-fix-and-map.md
// from the code. Run
// from apps/web:
//   pnpm --filter @crawlmouse/web exec tsx __tests__/v2/generate-spec.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SPEC_PATH, buildSpec } from './spec/build-spec';
import { SPEC_22_PATH, buildSpec22 } from './spec/build-spec-22';
import { SPEC_23_PATH, buildSpec23 } from './spec/build-spec-23';
import { SPEC_24_PATH, buildSpec24 } from './spec/build-spec-24';

for (const [path, build] of [
  [SPEC_PATH, buildSpec],
  [SPEC_22_PATH, buildSpec22],
  [SPEC_23_PATH, buildSpec23],
  [SPEC_24_PATH, buildSpec24],
] as const) {
  const spec = await build();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, spec);
  console.log(`wrote ${path}`);
}
