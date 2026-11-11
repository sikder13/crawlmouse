/**
 * The PostgREST stand-in (`__tests__/helpers/postgrest-pglite.ts`) with the two requests the keep
 * and expire stores make that it does not model:
 *
 * - `rpc(fn, args)` for any function in `public`, built from the catalog. The function is found by
 *   its name, each argument is passed by the name the caller gave and cast to the type the function
 *   declares for that name, and the answer has the shape of the function's return: one value, an
 *   array of values for `returns setof <scalar>`, an array of rows for `returns table`. A name the
 *   function does not declare is answered as PostgREST answers it, PGRST202, before anything runs.
 * - `from(table).select(columns, { count: 'exact', head: true })` with `eq`, `is` and `in`: the
 *   answer is `{ count, data: null, error }`.
 *
 * Other calls go to the stand-in unchanged. Each request is one transaction as `service_role`.
 * Not modelled: PostgREST's `max-rows` cap, and an overloaded function name (it throws).
 */
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { asRole } from '../../../../__tests__/helpers/pglite-migrations';
import { postgrestOver, type PostgrestError } from '../../../../__tests__/helpers/postgrest-pglite';

interface Answer {
  data: unknown;
  error: PostgrestError | null;
  count?: number | null;
}

interface Signature {
  args: Map<string, string>;
  returnsSet: boolean;
  returnsRows: boolean;
}

const ident = (s: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`not an identifier: ${s}`);
  return s;
};

function wire(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return Number(v);
  return v;
}

const wireRow = (row: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, wire(v)]));

function pgError(e: unknown): PostgrestError {
  const x = e as { code?: unknown; message?: unknown; detail?: unknown; hint?: unknown };
  if (typeof x.code !== 'string') throw e;
  return {
    code: x.code,
    message: String(x.message),
    details: typeof x.detail === 'string' ? x.detail : null,
    hint: typeof x.hint === 'string' ? x.hint : null,
  };
}

const thenable = (answer: () => Promise<Answer>) => ({
  then<T, E = never>(
    resolve: (v: Answer) => T | PromiseLike<T>,
    reject?: (e: unknown) => E | PromiseLike<E>,
  ): Promise<T | E> {
    return answer().then(resolve, reject);
  },
});

export function postgrestWithCatalog(pg: PGlite): SupabaseClient {
  const base = postgrestOver(pg);
  const asService = <T>(sql: string, params: unknown[]) =>
    asRole(pg, 'service_role', null, (tx) => tx.query<T>(sql, params));

  async function signatureOf(fn: string): Promise<Signature> {
    const { rows } = await pg.query<{
      names: string[] | null;
      modes: string[] | null;
      types: string[];
      retset: boolean;
      rettype: string;
    }>(
      `select p.proargnames as names, p.proargmodes::text[] as modes,
              array(select format_type(t, null)
                      from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) as t) as types,
              p.proretset as retset, (select typtype from pg_type where oid = p.prorettype) as rettype
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`,
      [fn],
    );
    if (rows.length !== 1)
      throw new Error(`${fn}: ${rows.length} functions of that name in public`);
    const r = rows[0]!;
    const args = new Map<string, string>();
    (r.names ?? []).forEach((name, i) => {
      // 'i' is an IN argument; a function with no OUT column has no modes at all.
      if ((r.modes?.[i] ?? 'i') === 'i') args.set(name, r.types[i]!);
    });
    const outColumns = (r.modes ?? []).some((m) => m === 't' || m === 'o');
    return { args, returnsSet: r.retset, returnsRows: outColumns || r.rettype === 'c' };
  }

  function rpc(fn: string, given: Record<string, unknown> = {}) {
    return thenable(async (): Promise<Answer> => {
      const signature = await signatureOf(ident(fn));
      // A JSON body carries no key whose value is undefined.
      const names = Object.keys(given).filter((n) => given[n] !== undefined);
      const unknown = names.filter((n) => !signature.args.has(n));
      const missing = [...signature.args.keys()].filter((n) => !names.includes(n));
      if (unknown.length > 0 || missing.length > 0) {
        return {
          data: null,
          error: {
            code: 'PGRST202',
            message: `Could not find the function public.${fn}(${names.join(', ')}) in the schema cache`,
            details: null,
            hint: null,
          },
        };
      }
      const params: unknown[] = [];
      const named = names.map((name) => {
        const type = signature.args.get(name)!;
        const value = given[name];
        // PostgREST reads the arguments from a JSON body: a json or jsonb argument takes the JSON.
        params.push(/^jsonb?$/.test(type) && value !== null ? JSON.stringify(value) : value);
        return `${ident(name)} => $${params.length}::${type}`;
      });
      const call = `public.${ident(fn)}(${named.join(', ')})`;
      try {
        if (signature.returnsRows) {
          const { rows } = await asService<Record<string, unknown>>(
            `select * from ${call}`,
            params,
          );
          return { data: rows.map(wireRow), error: null };
        }
        const { rows } = await asService<{ r: unknown }>(
          signature.returnsSet ? `select r from ${call} as r` : `select ${call} as r`,
          params,
        );
        const values = rows.map((row) => wire(row.r));
        return { data: signature.returnsSet ? values : values[0], error: null };
      } catch (e) {
        return { data: null, error: pgError(e) };
      }
    });
  }

  function countOf(table: string) {
    const where: string[] = [];
    const params: unknown[] = [];
    const param = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const filters = {
      eq(column: string, value: unknown) {
        where.push(`${ident(column)} = ${param(value)}`);
        return filters;
      },
      is(column: string, value: null | boolean) {
        if (value !== null && typeof value !== 'boolean')
          throw new Error('is takes null or a boolean');
        where.push(`${ident(column)} is ${String(value)}`);
        return filters;
      },
      in(column: string, values: readonly unknown[]) {
        where.push(`${ident(column)} = any(${param([...values])})`);
        return filters;
      },
      ...thenable(async (): Promise<Answer> => {
        try {
          const { rows } = await asService<{ n: number }>(
            `select count(*)::int as n from public.${ident(table)}` +
              (where.length > 0 ? ` where ${where.join(' and ')}` : ''),
            params,
          );
          return { count: rows[0]!.n, data: null, error: null };
        } catch (e) {
          return { count: null, data: null, error: pgError(e) };
        }
      }),
    };
    return filters;
  }

  return {
    rpc,
    from(table: string) {
      const builder = base.from(table) as unknown as {
        select(list?: string): unknown;
      } & Record<string, unknown>;
      return {
        ...builder,
        select(list?: string, opts?: { count?: string; head?: boolean }) {
          if (opts === undefined) return builder.select(list);
          if (opts.count !== 'exact' || opts.head !== true) {
            throw new Error(
              'the stand-in models select options { count: "exact", head: true } only',
            );
          }
          ident(list ?? 'id');
          return countOf(table);
        },
      };
    },
  } as unknown as SupabaseClient;
}
