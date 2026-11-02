import { resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { renderAccountsSpec } from '../../lib/entitlement-spec';
import {
  REPO_ROOT,
  V1_ENTITLEMENT_PATTERN,
  readSpecCatalog,
  v1EntitlementReaders,
} from './accounts-spec-catalog';
import { applyAllMigrations, freshDb } from './pglite-migrations';

export const SPEC_PATH = resolve(REPO_ROOT, 'docs/specs/v2/01-accounts.md');

/** The spec as the generator writes it: rendered from a migrated database and the repository, then Prettier. */
export async function buildAccountsSpec(): Promise<string> {
  const db = await freshDb();
  await applyAllMigrations(db);
  const md = renderAccountsSpec({
    catalog: await readSpecCatalog(db),
    v1Readers: v1EntitlementReaders(),
    readerPattern: V1_ENTITLEMENT_PATTERN,
  });
  const config = (await resolveConfig(SPEC_PATH)) ?? {};
  return format(md, { ...config, filepath: SPEC_PATH });
}
