/**
 * PostgREST's resource embedding (`select=*, report_schedules(*)`, `accounts!inner(kind)`,
 * `owner:seats!fk_name(id)`) over the repo's PostgREST stand-in (apps/web/__tests__/helpers/
 * postgrest-pglite.ts), which models plain column lists only. NOT part of the product.
 *
 * The relation is found as PostgREST finds it, from the foreign keys in the catalog: one from the
 * table to the embedded one is many-to-one (an object, or null); one from the embedded table to this
 * one is one-to-many (an array). A `!hint` names the constraint or the column to use. `!inner` drops
 * the rows with nothing to embed. Embeds nest. The embedded rows are read through the same client, so
 * row security applies to them as it does to the table's. What it does not model: filters on an
 * embedded resource's columns (`rel.col=eq.x`), embedding through a join table, computed relations.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';

interface ForeignKey {
  name: string;
  child: string;
  childCols: string[];
  parent: string;
  parentCols: string[];
}

export interface Embed {
  alias: string;
  table: string;
  hint: string | null;
  inner: boolean;
  select: string;
}

/** Splits a select list at its top-level commas: `a, b(c, d), e` → `a`, `b(c, d)`, `e`. */
function topLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

export function parseSelect(list: string): { columns: string[]; embeds: Embed[] } {
  const columns: string[] = [];
  const embeds: Embed[] = [];
  for (const item of topLevel(list)) {
    const m = /^(?:([a-z_][a-z0-9_]*):)?([a-z_][a-z0-9_]*)((?:![a-z0-9_]+)*)\((.*)\)$/s.exec(item);
    if (!m) {
      columns.push(item);
      continue;
    }
    const hints = (m[3] ?? '').split('!').filter(Boolean);
    embeds.push({
      alias: m[1] ?? m[2]!,
      table: m[2]!,
      inner: hints.includes('inner'),
      hint: hints.find((h) => h !== 'inner' && h !== 'left') ?? null,
      select: m[4]!.trim() || '*',
    });
  }
  return { columns, embeds };
}

let keys: ForeignKey[] | null = null;
async function foreignKeys(db: PGlite): Promise<ForeignKey[]> {
  if (keys) return keys;
  const r = await db.query<{
    name: string;
    child: string;
    parent: string;
    cc: string[];
    pc: string[];
  }>(
    `select c.conname as name, ch.relname as child, pa.relname as parent,
            array(select a.attname::text from unnest(c.conkey) with ordinality k(n, i)
                    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i) as cc,
            array(select a.attname::text from unnest(c.confkey) with ordinality k(n, i)
                    join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.i) as pc
       from pg_constraint c
       join pg_class ch on ch.oid = c.conrelid join pg_namespace n on n.oid = ch.relnamespace
       join pg_class pa on pa.oid = c.confrelid
      where c.contype = 'f' and n.nspname = 'public'`,
  );
  keys = r.rows.map((x) => ({
    name: x.name,
    child: x.child,
    childCols: x.cc,
    parent: x.parent,
    parentCols: x.pc,
  }));
  return keys;
}

type Row = Record<string, unknown>;
type AnyFn = (...args: unknown[]) => unknown;

async function relationOf(db: PGlite, table: string, e: Embed) {
  const all = await foreignKeys(db);
  const fits = (k: ForeignKey) =>
    e.hint === null || k.name === e.hint || k.childCols.includes(e.hint);
  const toOne = all.filter((k) => k.child === table && k.parent === e.table && fits(k));
  if (toOne[0]) return { many: false, local: toOne[0].childCols, remote: toOne[0].parentCols };
  const toMany = all.filter((k) => k.child === e.table && k.parent === table && fits(k));
  if (toMany[0]) return { many: true, local: toMany[0].parentCols, remote: toMany[0].childCols };
  throw new Error(`standin: no relation from ${table} to ${e.table}${e.hint ? `!${e.hint}` : ''}`);
}

/** The rows with each embed attached; `!inner` embeds that found nothing drop their row. */
export async function attachEmbeds(
  db: PGlite,
  client: SupabaseClient,
  table: string,
  rows: Row[],
  embeds: readonly Embed[],
): Promise<Row[]> {
  let out = rows;
  for (const e of embeds) {
    const rel = await relationOf(db, table, e);
    // One column per side covers this schema's embeds; a composite key is matched on its first.
    const local = rel.local[0]!;
    const remote = rel.remote[0]!;
    const values = [
      ...new Set(out.map((r) => r[local]).filter((v) => v !== null && v !== undefined)),
    ];
    const inner = parseSelect(e.select);
    const cols = inner.columns.includes('*')
      ? '*'
      : [...new Set([...inner.columns, remote])].join(', ');
    let related: Row[] = [];
    if (values.length > 0) {
      const { data, error } = await client.from(e.table).select(cols).in(remote, values);
      if (error)
        throw new Error(`standin: embed ${e.table}: ${(error as { message: string }).message}`);
      related = await attachEmbeds(db, client, e.table, (data ?? []) as Row[], inner.embeds);
    }
    const strip = (r: Row) => {
      if (inner.columns.includes('*') || inner.columns.includes(remote)) return r;
      const rest = { ...r };
      delete rest[remote];
      return rest;
    };
    out = out
      .map((r) => {
        const hits = related.filter((x) => x[remote] === r[local]).map(strip);
        return { ...r, [e.alias]: rel.many ? hits : (hits[0] ?? null) };
      })
      .filter(
        (r) => !e.inner || (rel.many ? (r[e.alias] as Row[]).length > 0 : r[e.alias] !== null),
      );
  }
  return out;
}

const pick = (row: Row, columns: readonly string[], aliases: readonly string[]): Row =>
  columns.includes('*')
    ? row
    : Object.fromEntries(
        Object.entries(row).filter(([k]) => columns.includes(k) || aliases.includes(k)),
      );

/**
 * The client with embedding added: a `select` naming an embed reads every column of the table (so
 * the join keys are there), attaches the embeds when the request resolves, and keeps only the
 * columns asked for. A select with no embed is passed through unchanged.
 */
export function embeddingClient(db: PGlite, client: SupabaseClient): SupabaseClient {
  const wrap = (
    chain: unknown,
    table: string,
    asked: { columns: string[]; embeds: Embed[] } | null,
  ): unknown =>
    new Proxy(chain as object, {
      get(target, prop) {
        const t = target as Record<string | symbol, unknown>;
        if (prop === 'select') {
          return (list = '*', ...rest: unknown[]) => {
            const parsed = parseSelect(list);
            if (parsed.embeds.length === 0)
              return wrap((t.select as AnyFn)(list, ...rest), table, asked);
            return wrap((t.select as AnyFn)('*', ...rest), table, parsed);
          };
        }
        if (prop === 'then' && asked !== null) {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            (t.then as AnyFn).call(
              target,
              async (answer: { data: unknown; error: unknown }) => {
                if (answer.error || answer.data === null) return resolve(answer);
                const one = !Array.isArray(answer.data);
                const rows = (one ? [answer.data] : answer.data) as Row[];
                const attached = await attachEmbeds(db, client, table, rows, asked.embeds);
                const shaped = attached.map((r) =>
                  pick(
                    r,
                    asked.columns,
                    asked.embeds.map((e) => e.alias),
                  ),
                );
                return resolve({ ...answer, data: one ? (shaped[0] ?? null) : shaped });
              },
              reject,
            );
        }
        const v = t[prop];
        return typeof v === 'function'
          ? (...a: unknown[]) => wrap((v as AnyFn).apply(target, a), table, asked)
          : v;
      },
    });
  return new Proxy(client as object, {
    get(target, prop) {
      if (prop === 'from') return (table: string) => wrap(client.from(table), table, null);
      return (target as Record<string | symbol, unknown>)[prop];
    },
  }) as SupabaseClient;
}
