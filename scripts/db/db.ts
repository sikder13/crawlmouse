import postgres from 'postgres';

export type Row = Record<string, unknown>;

/**
 * The one database surface the scripts use. `query` takes bound parameters; `exec` runs a whole
 * script as one simple-protocol query (a migration or rollback file's bytes); `transaction` runs a
 * function inside BEGIN/COMMIT and rolls back on a throw.
 */
export interface Db {
  query<T extends Row = Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

type Sql = postgres.Sql | postgres.TransactionSql;

function wrap(sql: Sql, close: () => Promise<void>): Db {
  return {
    async query<T extends Row>(text: string, params: readonly unknown[] = []) {
      return (await sql.unsafe(
        text,
        params as postgres.ParameterOrJSON<never>[],
      )) as unknown as T[];
    },
    async exec(text: string) {
      await sql.unsafe(text).simple();
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      if (!('begin' in sql)) throw new Error('nested transactions are not used by these scripts');
      return (await sql.begin((tx) => fn(wrap(tx, async () => {})))) as T;
    },
    close,
  };
}

/**
 * A direct connection. The URL comes from the caller and is never logged here; TLS follows its
 * `sslmode` parameter (supabase-api.ts builds pooler URLs with `sslmode=require`).
 */
export function connect(url: string): Db {
  const sql = postgres(url, {
    max: 1,
    onnotice: () => {},
    connection: { application_name: 'crawlmouse-db-ops' },
  });
  return wrap(sql, () => sql.end({ timeout: 5 }));
}

export const MANAGEMENT_API = 'https://api.supabase.com';

/**
 * Reads through the Management API's read-only endpoint, which runs as `supabase_read_only_user`.
 * It takes no parameters and cannot write, so it serves the checks and the fingerprint on a target
 * whose database password the caller does not hold.
 */
export function readOnlyApi(ref: string, token: string, fetchImpl: typeof fetch = fetch): Db {
  const refuse = () => {
    throw new Error('the read-only Management API connection cannot write');
  };
  return {
    async query<T extends Row>(text: string, params: readonly unknown[] = []) {
      if (params.length > 0) throw new Error('the read-only Management API takes no parameters');
      const res = await fetchImpl(`${MANAGEMENT_API}/v1/projects/${ref}/database/query/read-only`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query: text }),
      });
      if (!res.ok) {
        throw new Error(`read-only query on ${ref} failed: HTTP ${res.status} ${await res.text()}`);
      }
      return (await res.json()) as T[];
    },
    exec: async () => refuse(),
    transaction: async () => refuse(),
    close: async () => {},
  };
}
