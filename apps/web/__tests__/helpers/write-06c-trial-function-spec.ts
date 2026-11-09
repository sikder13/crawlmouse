/**
 * Writes docs/specs/v2/06c-trial-function.md from the code:
 *   pnpm --filter @crawlmouse/web exec tsx __tests__/helpers/write-06c-trial-function-spec.ts
 */
import { writeFileSync } from 'node:fs';
import { buildTrialFunctionSpec, SPEC_06C_PATH } from './trial-function-spec';

buildTrialFunctionSpec()
  .then((md) => {
    writeFileSync(SPEC_06C_PATH, md);
    process.stdout.write(`wrote ${SPEC_06C_PATH}\n`);
  })
  .catch((err: unknown) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
