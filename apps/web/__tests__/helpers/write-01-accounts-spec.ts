/**
 * Writes docs/specs/v2/01-accounts.md from the code:
 *   pnpm --filter @crawlmouse/web exec tsx __tests__/helpers/write-01-accounts-spec.ts
 */
import { writeFileSync } from 'node:fs';
import { buildAccountsSpec, SPEC_PATH } from './accounts-spec-build';

buildAccountsSpec()
  .then((md) => {
    writeFileSync(SPEC_PATH, md);
    process.stdout.write(`wrote ${SPEC_PATH}\n`);
  })
  .catch((err: unknown) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
