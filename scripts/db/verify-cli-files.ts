import { pathToFileURL } from 'node:url';
import { listMigrations } from './files';
import { dbPush } from './supabase-cli';

/**
 * Proves, with the real CLI, that `supabase db push` reads infra/supabase/migrations exactly: against
 * an EMPTY database every file is pending, so the CLI's dry-run list must equal the directory.
 * CI runs it against a Postgres service container.
 *
 *   DB_URL=postgresql://... tsx scripts/db/verify-cli-files.ts
 */
async function main(): Promise<void> {
  const url = process.env.DB_URL;
  if (!url) throw new Error('DB_URL is not set');
  const { files } = await dbPush(url, { dryRun: true });
  const expected = listMigrations().map((m) => m.file);
  if (files.join('\n') !== expected.join('\n')) {
    throw new Error(`the CLI lists ${files.length} files, the directory holds ${expected.length}`);
  }
  console.log(`the CLI lists the ${files.length} files of infra/supabase/migrations, in order`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
