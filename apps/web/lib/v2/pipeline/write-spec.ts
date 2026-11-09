// Writes docs/specs/v2/20b-pipeline.md from spec.ts. Run from the repository root:
//   pnpm --filter @crawlmouse/web exec tsx lib/v2/pipeline/write-spec.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { SPEC_20B_PATH, buildSpec20b } from './spec';

async function main(): Promise<void> {
  const path = fileURLToPath(new URL(`../../../../../${SPEC_20B_PATH}`, import.meta.url));
  const options = { ...(await resolveConfig(path)), filepath: path };
  writeFileSync(path, await format(`${buildSpec20b()}\n`, options));
  console.log(`wrote ${path}`);
}

void main();
