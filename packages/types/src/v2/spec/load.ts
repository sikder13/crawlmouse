import { readFileSync } from 'node:fs';
import { FixtureDatasetSchema, type FixtureDataset } from '../fixture.js';

const ROOT = new URL('../../../../../', import.meta.url);
export const SPEC_URL = new URL('docs/specs/v2/11-type-contract.md', ROOT);
export const FIXTURE_NAMES = ['bad-site', 'clean-site', 'challenged-site'] as const;

export function loadFixtures(): Record<string, FixtureDataset> {
  return Object.fromEntries(
    FIXTURE_NAMES.map((name) => [
      name,
      FixtureDatasetSchema.parse(
        JSON.parse(readFileSync(new URL(`apps/web/lib/fixtures/v2/${name}.json`, ROOT), 'utf8')),
      ),
    ]),
  );
}
