import { pathToFileURL } from 'node:url';
import { credentials, restClient, type Rest } from './supabase-rest';

/**
 * Who may use the support console (CC-33 D1): rows of `operators`, written with the service role.
 *
 *   pnpm ops:operator add <email>      the user with that address becomes an operator
 *   pnpm ops:operator remove <email>   they stop being one
 *   pnpm ops:operator list             every operator's user id, and when they were added
 *
 * The address is matched lower-cased against `users.email`; an address with no user is refused. It
 * prints user ids only, never an address. Credentials: scripts/ops/supabase-rest.ts.
 */

const USAGE = 'usage: ops:operator add <email> | remove <email> | list';

async function userIdOf(rest: Rest, email: string): Promise<string> {
  const rows = (await rest.call(
    'GET',
    `users?select=id&email=eq.${encodeURIComponent(email.trim().toLowerCase())}`,
  )) as { id: string }[];
  if (rows.length !== 1) throw new Error('no user has that address');
  return rows[0]!.id;
}

export async function runOperator(
  args: readonly string[],
  rest: Rest,
  print: (line: string) => void,
): Promise<void> {
  const [verb, email, ...extra] = args;
  if (verb === 'list' && email === undefined) {
    const rows = (await rest.call(
      'GET',
      'operators?select=user_id,added_at&order=added_at.asc',
    )) as { user_id: string; added_at: string }[];
    for (const r of rows) print(`${r.user_id}  added ${r.added_at}`);
    if (rows.length === 0) print('no operators');
    return;
  }
  if ((verb !== 'add' && verb !== 'remove') || !email || extra.length > 0) throw new Error(USAGE);
  const userId = await userIdOf(rest, email);
  if (verb === 'add') {
    await rest.call(
      'POST',
      'operators?on_conflict=user_id',
      { user_id: userId },
      'resolution=ignore-duplicates',
    );
    print(`operator added: user ${userId}`);
  } else {
    const gone = (await rest.call(
      'DELETE',
      `operators?user_id=eq.${userId}`,
      undefined,
      'return=representation',
    )) as unknown[] | null;
    print(
      gone && gone.length > 0
        ? `operator removed: user ${userId}`
        : `user ${userId} was not an operator`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const main = async () =>
    runOperator(process.argv.slice(2), restClient(credentials()), (l) => console.log(l));
  main().catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
}
