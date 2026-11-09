// Writes docs/specs/v2/21-design-system.md, 22-audit-flow.md, 23-segments.md, 24-fix-and-map.md,
// 25-account-door.md and 26-dashboard-site.md from the code. Run from apps/web:
//   pnpm --filter @crawlmouse/web exec tsx __tests__/v2/generate-spec.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SPEC_PATH, buildSpec } from './spec/build-spec';
import { SPEC_22_PATH, buildSpec22 } from './spec/build-spec-22';
import { SPEC_23_PATH, buildSpec23 } from './spec/build-spec-23';
import { SPEC_24_PATH, buildSpec24 } from './spec/build-spec-24';
import { SPEC_25_PATH, buildSpec25 } from './spec/build-spec-25';
import { SPEC_26_PATH, buildSpec26 } from './spec/build-spec-26';

for (const [path, build] of [
  [SPEC_PATH, buildSpec],
  [SPEC_22_PATH, buildSpec22],
  [SPEC_23_PATH, buildSpec23],
  [SPEC_24_PATH, buildSpec24],
  [SPEC_25_PATH, buildSpec25],
  [SPEC_26_PATH, buildSpec26],
] as const) {
  const spec = await build();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, spec);
  console.log(`wrote ${path}`);
}
