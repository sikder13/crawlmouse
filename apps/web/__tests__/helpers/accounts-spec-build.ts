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

/** SPEC 01 documents migration 001, so it is rendered from the catalog 001 leaves. */
const THROUGH_001 = (file: string) => file <= '20261101000001_v2_001_entitlement_tables.sql';

export const SPEC_PATH = resolve(REPO_ROOT, 'docs/specs/v2/01-accounts.md');

/** The spec as the generator writes it: rendered from a database migrated through 001 and the repository, then Prettier. */
export async function buildAccountsSpec(): Promise<string> {
  const db = await freshDb();
  await applyAllMigrations(db, undefined, THROUGH_001);
  const md = renderAccountsSpec({
    catalog: await readSpecCatalog(db),
    v1Readers: v1EntitlementReaders(),
    readerPattern: V1_ENTITLEMENT_PATTERN,
  });
  const config = (await resolveConfig(SPEC_PATH)) ?? {};
  return format(md, { ...config, filepath: SPEC_PATH });
}
