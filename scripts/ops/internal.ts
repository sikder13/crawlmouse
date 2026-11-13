import { pathToFileURL } from 'node:url';
import { credentials, restClient, type Rest } from './supabase-rest';

/**
 * Marks an account as ours (CC-33 D1): `accounts.internal`, written with the service role. An
 * internal account's server events carry `internal: true`.
 *
 *   pnpm ops:internal <account-id>         mark it internal
 *   pnpm ops:internal <account-id> --off   unmark it
 *
 * Refuses an id that is not a uuid, and one that names no account. Prints the account id only.
 * Credentials: scripts/ops/supabase-rest.ts.
 */

const USAGE = 'usage: ops:internal <account-id> [--off]';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function runInternal(
  args: readonly string[],
  rest: Rest,
  print: (line: string) => void,
): Promise<void> {
  const [id, flag, ...extra] = args;
  if (!id || !UUID.test(id) || (flag !== undefined && flag !== '--off') || extra.length > 0) {
    throw new Error(USAGE);
  }
  const internal = flag === undefined;
  const rows = (await rest.call(
    'PATCH',
    `accounts?id=eq.${id}&select=id`,
    { internal },
    'return=representation',
  )) as { id: string }[] | null;
  if (!rows || rows.length !== 1) throw new Error(`no account ${id}`);
  print(`account ${id}: ${internal ? 'internal' : 'not internal'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const main = async () =>
    runInternal(process.argv.slice(2), restClient(credentials()), (l) => console.log(l));
  main().catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
}
