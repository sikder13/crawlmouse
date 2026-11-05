import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ManagementApi } from './supabase-api';
import { PRODUCTION_REF } from './target';

/**
 * Deletes production's preview branch of the given name, if there is one. db-dry-run.yml runs it
 * when a pull request closes; the dry run itself deletes its branch when it finishes.
 *
 *   SUPABASE_ACCESS_TOKEN=... tsx scripts/db/delete-branch.ts --name pr-<number>
 */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { name: { type: 'string', default: '' } } });
  if (!/^pr-\d+$/.test(values.name)) throw new Error('--name must be pr-<number>');
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
  const api = new ManagementApi(token);
  const branches = (await api.listBranches(PRODUCTION_REF)).filter((b) => b.name === values.name);
  for (const b of branches) {
    await api.deleteBranch(b.project_ref);
    console.log(`deleted branch ${b.name} (${b.project_ref})`);
  }
  if (branches.length === 0) console.log(`no branch named ${values.name}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
