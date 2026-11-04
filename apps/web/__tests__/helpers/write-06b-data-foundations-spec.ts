/**
 * Writes docs/specs/v2/06b-data-foundations.md from the code:
 *   pnpm --filter @crawlmouse/web exec tsx __tests__/helpers/write-06b-data-foundations-spec.ts
 */
import { writeFileSync } from 'node:fs';
import { buildDataFoundationsSpec, SPEC_06B_PATH } from './data-foundations-spec';

buildDataFoundationsSpec()
  .then((md) => {
    writeFileSync(SPEC_06B_PATH, md);
    process.stdout.write(`wrote ${SPEC_06B_PATH}\n`);
  })
  .catch((err: unknown) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
