/**
 * Writes docs/specs/v2/06-check-tables.md from the code:
 *   pnpm --filter @crawlmouse/web exec tsx __tests__/helpers/write-06-check-tables-spec.ts
 */
import { writeFileSync } from 'node:fs';
import { buildCheckTablesSpec, SPEC_06_PATH } from './check-tables-spec';

buildCheckTablesSpec()
  .then((md) => {
    writeFileSync(SPEC_06_PATH, md);
    process.stdout.write(`wrote ${SPEC_06_PATH}\n`);
  })
  .catch((err: unknown) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
