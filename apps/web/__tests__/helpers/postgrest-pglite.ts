/**
 * A PostgREST stand-in over PGlite, so a service-role port that ships runs its own query-builder
 * calls against the migrated schema (the v2 webhook's `supabaseWebhookDb` in
 * apps/web/lib/billing/webhook-db.ts). Each request is one transaction as `service_role`, as
 * PostgREST runs one, and answers the way supabase-js does: `{ data, error }`; timestamps as ISO
 * strings and bigints as numbers; a database error as `{ code, message, details, hint }`;
 * `maybeSingle` as the one row, null for none, PGRST116 for more.
 *
 * Modelled: `from(table)` with `select`, `insert`, `upsert` (`onConflict` required,
 * `ignoreDuplicates`) and `update`; the filters `eq`, `neq`, `gte`, `lt`, `is`,
 * `not(column, 'is' | 'eq', value)` and `in`; `order`, `limit`, `range` and `maybeSingle` after a
 * `select`, and `single` (one row, else PGRST116, as for none); and `rpc(fn, args)` for a function that returns one value, or, for a set-returning
 * function (`returns table` / `setof`), its rows as an array, as PostgREST answers one.
 * `maxRows` caps every read, a set-returning function's rows included, as PostgREST's `db-max-rows`
 * does. The builders carry no other method, so a call a port adds throws in its test
 * until it is modelled here.
 *
 * `log` receives each request as the calls that built it, when it is sent. `before` runs ahead of
 * each request with those calls, for a test that changes the database between two requests.
 * `as` runs each request as a signed-in caller instead (`authenticated`, with that user as the JWT
 * subject), so row security and column grants apply as they do to a session client.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { asRole } from './pglite-migrations';

export type Call = [method: string, ...args: unknown[]];

export interface PostgrestOptions {
  log?: Call[][];
  before?: (request: readonly Call[]) => Promise<void>;
  as?: { userId: string };
  /** The most rows one read returns, as PostgREST's `db-max-rows`; no cap when omitted. */
  maxRows?: number;
}

export interface PostgrestError {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

interface Answer {
  data: unknown;
  error: PostgrestError | null;
}

const ident = (s: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`not an identifier: ${s}`);
  return s;
};

/** A column list, each name quoted, so a column named as a keyword (`changes.where`) reads. */
const columnsOf = (list: string): string =>
  list === '*'
    ? '*'
    : list
        .split(',')
        .map((c) => `"${ident(c.trim())}"`)
        .join(', ');

/** A value as PostgREST puts it on the wire. */
function wire(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return Number(v);
  return v;
}

/** A value as PostgREST hands it to Postgres: a JSON object as JSON. */
function sqlValue(v: unknown): unknown {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
    ? JSON.stringify(v)
    : v;
}

function rowObject(row: unknown): Record<string, unknown> {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('the stand-in writes one row, given as an object');
  }
  return row as Record<string, unknown>;
}

export function postgrestOver(pg: PGlite, options: PostgrestOptions = {}): SupabaseClient {
  const capped = (limit: number | null): number | null =>
    options.maxRows === undefined ? limit : Math.min(limit ?? options.maxRows, options.maxRows);
  /** Sends one request; a database error is answered, anything else is thrown. */
  async function send(
    calls: Call[],
    sql: string,
    params: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] } | { error: PostgrestError }> {
    options.log?.push(calls);
    await options.before?.(calls);
    try {
      const role = options.as === undefined ? 'service_role' : 'authenticated';
      const { rows } = await asRole(pg, role, options.as?.userId ?? null, (tx) =>
        tx.query<Record<string, unknown>>(sql, params),
      );
      return {
        rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, wire(v)]))),
      };
    } catch (e) {
      const x = e as { code?: unknown; message?: unknown; detail?: unknown; hint?: unknown };
      if (typeof x.code !== 'string') throw e;
      return {
        error: {
          code: x.code,
          message: String(x.message),
          details: typeof x.detail === 'string' ? x.detail : null,
          hint: typeof x.hint === 'string' ? x.hint : null,
        },
      };
    }
  }

  function table(name: string) {
    const target = `public.${ident(name)}`;
    const calls: Call[] = [['from', name]];
    const params: unknown[] = [];
    const where: string[] = [];
    const ordering: string[] = [];
    let limit: number | null = null;
    let offset = 0;
    let single = false;
    let exactlyOne = false;
    let reads = false;
    let statement = '';

    const param = (v: unknown) => {
      params.push(sqlValue(v));
      return `$${params.length}`;
    };
    const whereSql = () => (where.length > 0 ? ` where ${where.join(' and ')}` : '');
    const readOnly = (method: string) => {
      if (!reads) throw new Error(`the stand-in models ${method} after a select only`);
    };

    async function answer(): Promise<Answer> {
      const sql = reads
        ? `select ${statement} from ${target}${whereSql()}` +
          (ordering.length > 0 ? ` order by ${ordering.join(', ')}` : '') +
          (capped(limit) === null ? '' : ` limit ${capped(limit)}`) +
          (offset === 0 ? '' : ` offset ${offset}`)
        : `${statement}${whereSql()}`;
      const r = await send(calls, sql, params);
      if ('error' in r) return { data: null, error: r.error };
      if (!reads) return { data: null, error: null };
      if (!single) return { data: r.rows, error: null };
      if (r.rows.length > 1 || (exactlyOne && r.rows.length === 0)) {
        return {
          data: null,
          error: {
            code: 'PGRST116',
            message: 'JSON object requested, multiple (or no) rows returned',
            details: `Results contain ${r.rows.length} rows, application/vnd.pgrst.object+json requires 1 row`,
            hint: null,
          },
        };
      }
      return { data: r.rows[0] ?? null, error: null };
    }

    const filters = {
      eq(column: string, value: unknown) {
        calls.push(['eq', column, value]);
        where.push(`${ident(column)} = ${param(value)}`);
        return filters;
      },
      neq(column: string, value: unknown) {
        calls.push(['neq', column, value]);
        where.push(`${ident(column)} <> ${param(value)}`);
        return filters;
      },
      gte(column: string, value: unknown) {
        calls.push(['gte', column, value]);
        where.push(`${ident(column)} >= ${param(value)}`);
        return filters;
      },
      lt(column: string, value: unknown) {
        calls.push(['lt', column, value]);
        where.push(`${ident(column)} < ${param(value)}`);
        return filters;
      },
      is(column: string, value: null | boolean) {
        calls.push(['is', column, value]);
        if (value !== null && typeof value !== 'boolean')
          throw new Error('is takes null or a boolean');
        where.push(`${ident(column)} is ${String(value)}`);
        return filters;
      },
      not(column: string, operator: string, value: unknown) {
        calls.push(['not', column, operator, value]);
        if (operator === 'is' && (value === null || typeof value === 'boolean')) {
          where.push(`${ident(column)} is not ${String(value)}`);
        } else if (operator === 'eq') {
          where.push(`not (${ident(column)} = ${param(value)})`);
        } else {
          throw new Error(`the stand-in does not model not.${operator}`);
        }
        return filters;
      },
      in(column: string, values: readonly unknown[]) {
        calls.push(['in', column, values]);
        where.push(`${ident(column)} = any(${param([...values])})`);
        return filters;
      },
      order(column: string, opts: { ascending?: boolean } = {}) {
        calls.push(['order', column, opts]);
        readOnly('order');
        ordering.push(`${ident(column)} ${opts.ascending === false ? 'desc' : 'asc'}`);
        return filters;
      },
      limit(n: number) {
        calls.push(['limit', n]);
        readOnly('limit');
        if (!Number.isInteger(n) || n < 0) throw new Error('limit takes a whole number');
        limit = n;
        return filters;
      },
      range(from: number, to: number) {
        calls.push(['range', from, to]);
        readOnly('range');
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from)
          throw new Error('range takes 0 <= from <= to');
        offset = from;
        limit = to - from + 1;
        return filters;
      },
      maybeSingle() {
        calls.push(['maybeSingle']);
        readOnly('maybeSingle');
        single = true;
        return filters;
      },
      single() {
        calls.push(['single']);
        readOnly('single');
        single = true;
        exactlyOne = true;
        return filters;
      },
      then<T, E = never>(
        resolve: (v: Answer) => T | PromiseLike<T>,
        reject?: (e: unknown) => E | PromiseLike<E>,
      ): Promise<T | E> {
        return answer().then(resolve, reject);
      },
    };

    return {
      select(list = '*') {
        calls.push(['select', list]);
        reads = true;
        statement = columnsOf(list);
        return filters;
      },
      insert(row: unknown) {
        calls.push(['insert', row]);
        const r = rowObject(row);
        const cols = Object.keys(r).map(ident);
        statement = `insert into ${target} (${cols.join(', ')}) values (${cols.map((c) => param(r[c])).join(', ')})`;
        return filters;
      },
      upsert(row: unknown, opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
        calls.push(['upsert', row, opts]);
        const r = rowObject(row);
        if (opts.onConflict === undefined) throw new Error('the stand-in needs onConflict');
        const cols = Object.keys(r).map(ident);
        const conflict = columnsOf(opts.onConflict);
        const resolution = opts.ignoreDuplicates
          ? 'do nothing'
          : `do update set ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}`;
        statement =
          `insert into ${target} (${cols.join(', ')}) values (${cols.map((c) => param(r[c])).join(', ')})` +
          ` on conflict (${conflict}) ${resolution}`;
        return filters;
      },
      update(values: unknown) {
        calls.push(['update', values]);
        const r = rowObject(values);
        const sets = Object.keys(r).map((c) => `${ident(c)} = ${param(r[c])}`);
        statement = `update ${target} set ${sets.join(', ')}`;
        return filters;
      },
    };
  }

  return {
    from: table,
    rpc(fn: string, args: Record<string, unknown> = {}) {
      const calls: Call[] = [['rpc', fn, args]];
      const params: unknown[] = [];
      const named = Object.entries(args).map(([k, v]) => {
        params.push(sqlValue(v));
        return `${ident(k)} => $${params.length}`;
      });
      const scalar = `select public.${ident(fn)}(${named.join(', ')}) as r`;
      return {
        async then<T, E = never>(
          resolve: (v: Answer) => T | PromiseLike<T>,
          reject?: (e: unknown) => E | PromiseLike<E>,
        ): Promise<T | E> {
          const { rows } = await pg.query<{ set: boolean }>(
            `select bool_or(p.proretset) as set from pg_catalog.pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
            [fn],
          );
          const set = rows[0]?.set === true;
          const cap = capped(null);
          const sql = set
            ? `select * from public.${ident(fn)}(${named.join(', ')})` +
              (cap === null ? '' : ` limit ${cap}`)
            : scalar;
          return send(calls, sql, params)
            .then((r): Answer => {
              if ('error' in r) return { data: null, error: r.error };
              return { data: set ? r.rows : r.rows[0]!.r, error: null };
            })
            .then(resolve, reject);
        },
      };
    },
  } as unknown as SupabaseClient;
}
