/**
 * Renders spec 03's event × state table into docs/specs/v2/03-billing.md:
 *   pnpm --filter @crawlmouse/web exec tsx __tests__/helpers/write-03-billing-spec.ts
 */
import { writeFileSync } from 'node:fs';
import { buildBillingSpec, SPEC_03_PATH } from './billing-spec';

buildBillingSpec()
  .then((md) => {
    writeFileSync(SPEC_03_PATH, md);
    process.stdout.write(`wrote ${SPEC_03_PATH}\n`);
  })
  .catch((err: unknown) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
