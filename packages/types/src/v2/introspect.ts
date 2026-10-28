/**
 * Schema-guided traversal of the v2 contract.
 *
 * The contract test and the spec renderer both need to ask questions about the SHAPE of the schemas
 * (which fields exist, which are required, which enums and unions are reachable) and about which parts
 * of a fixture exercise which part of a schema. Reading the zod definitions is the only way to answer
 * those questions without keeping a second, hand-written list of fields that would drift from the
 * schemas themselves.
 *
 * Unsupported schema kinds, and literals that allow more than one value, throw rather than being
 * skipped, so those constructs cannot silently fall out of enum coverage.
 */
import type { z } from 'zod';

type Schema = z.core.$ZodType;
export type Path = (string | number)[];

interface Def {
  type: string;
  shape?: Record<string, Schema>;
  element?: Schema;
  innerType?: Schema;
  options?: Schema[];
  entries?: Record<string, string>;
  values?: unknown[];
}

function def(schema: Schema): Def {
  return (schema as unknown as { _zod: { def: Def } })._zod.def;
}

function parses(schema: Schema, value: unknown): boolean {
  return (schema as z.ZodType).safeParse(value).success;
}

const LEAF_TYPES = new Set(['string', 'number', 'boolean', 'literal', 'null']);

/** A literal that allows more than one value is an enum in disguise and would escape enum coverage. */
function assertSingleLiteral(schema: Schema, at: string): void {
  if (def(schema).type === 'literal' && (def(schema).values ?? []).length !== 1) {
    throw new Error(`introspect: a multi-value literal at ${at}; use a registered z.enum`);
  }
}

export interface Visitor {
  /** An enum-typed position holding `value`. */
  enumValue?(schema: Schema, value: string, path: Path): void;
  /** The `index`-th option of a union was the one `value` matched. */
  unionOption?(schema: Schema, index: number, path: Path): void;
  /** A required key (not `.optional()`; nullable still counts as required) that is present. */
  requiredKey?(path: Path): void;
}

/** Walk `value` along `schema`. Call only on a value that already parsed with `schema`. */
export function walk(schema: Schema, value: unknown, visitor: Visitor, path: Path = []): void {
  const d = def(schema);
  switch (d.type) {
    case 'optional':
      if (value !== undefined) walk(d.innerType!, value, visitor, path);
      return;
    case 'nullable':
      if (value !== null) walk(d.innerType!, value, visitor, path);
      return;
    case 'enum':
      visitor.enumValue?.(schema, value as string, path);
      return;
    case 'object': {
      const obj = value as Record<string, unknown>;
      for (const [key, field] of Object.entries(d.shape!)) {
        if (!Object.hasOwn(obj, key)) continue;
        if (def(field).type !== 'optional') visitor.requiredKey?.([...path, key]);
        walk(field, obj[key], visitor, [...path, key]);
      }
      return;
    }
    case 'array':
      (value as unknown[]).forEach((item, i) => walk(d.element!, item, visitor, [...path, i]));
      return;
    case 'union': {
      const index = d.options!.findIndex((option) => parses(option, value));
      if (index < 0) throw new Error(`introspect: no union option matches at /${path.join('/')}`);
      visitor.unionOption?.(schema, index, path);
      walk(d.options![index]!, value, visitor, path);
      return;
    }
    default:
      assertSingleLiteral(schema, `/${path.join('/')}`);
      if (LEAF_TYPES.has(d.type)) return;
      throw new Error(`introspect: unsupported schema type "${d.type}" at /${path.join('/')}`);
  }
}

export interface Node {
  schema: Schema;
  /** Dotted field path; array elements are marked `[]`, union options `<n>`. */
  path: string;
}

/** Every schema node reachable from `schema`, without any data. */
export function nodes(schema: Schema, path = ''): Node[] {
  const d = def(schema);
  const here: Node = { schema, path };
  switch (d.type) {
    case 'optional':
    case 'nullable':
      return [here, ...nodes(d.innerType!, path)];
    case 'object':
      return [
        here,
        ...Object.entries(d.shape!).flatMap(([key, field]) =>
          nodes(field, path ? `${path}.${key}` : key),
        ),
      ];
    case 'array':
      return [here, ...nodes(d.element!, `${path}[]`)];
    case 'union':
      return [here, ...d.options!.flatMap((option, i) => nodes(option, `${path}<${i}>`))];
    case 'enum':
      return [here];
    default:
      assertSingleLiteral(schema, path);
      if (LEAF_TYPES.has(d.type)) return [here];
      throw new Error(`introspect: unsupported schema type "${d.type}" at ${path}`);
  }
}

/** How many checks are attached to this schema itself, not to its fields. */
export function ownCheckCount(schema: Schema): number {
  return ((def(schema) as Def & { checks?: unknown[] }).checks ?? []).length;
}

/** An object that rejects keys it does not declare (z.strictObject), rather than dropping them. */
export function isStrictObject(schema: Schema): boolean {
  const catchall = (def(schema) as Def & { catchall?: Schema }).catchall;
  return def(schema).type === 'object' && catchall !== undefined && def(catchall).type === 'never';
}

export function schemaType(schema: Schema): string {
  return def(schema).type;
}

/** The string or number format zod records (`uuid`, `datetime`, `safeint`...), if any. */
export function schemaFormat(schema: Schema): string | undefined {
  return (def(schema) as Def & { format?: string }).format;
}

/** The `.max()` an array (or string) schema declares, if any. */
export function maxLength(schema: Schema): number | undefined {
  const checks =
    (def(schema) as Def & { checks?: { _zod: { def: { check: string; maximum?: number } } }[] })
      .checks ?? [];
  return checks.map((c) => c._zod.def).find((d) => d.check === 'max_length')?.maximum;
}

export function arrayElement(schema: Schema): Schema | undefined {
  return def(schema).element;
}

export function enumValues(schema: Schema): string[] {
  return Object.values(def(schema).entries ?? {});
}

export function unionOptions(schema: Schema): Schema[] {
  return def(schema).options ?? [];
}

export function literalValues(schema: Schema): unknown[] {
  return def(schema).values ?? [];
}

/** Unwrap `.optional()` / `.nullable()` layers. */
export function unwrap(schema: Schema): Schema {
  const d = def(schema);
  return d.type === 'optional' || d.type === 'nullable' ? unwrap(d.innerType!) : schema;
}

export function isOptional(schema: Schema): boolean {
  return def(schema).type === 'optional';
}

export function isNullable(schema: Schema): boolean {
  const d = def(schema);
  if (d.type === 'nullable') return true;
  return d.type === 'optional' ? isNullable(d.innerType!) : false;
}

/** The keys of an object schema (after unwrapping), or [] for anything else. */
export function objectKeys(schema: Schema): string[] {
  const d = def(unwrap(schema));
  return d.type === 'object' ? Object.keys(d.shape!) : [];
}

export function objectShape(schema: Schema): Record<string, Schema> {
  const d = def(unwrap(schema));
  if (d.type !== 'object') throw new Error('introspect: not an object schema');
  return d.shape!;
}

/** Every object key reachable from `schema`, at any depth. */
export function allFieldNames(schema: Schema): Set<string> {
  const names = new Set<string>();
  for (const node of nodes(schema)) for (const key of objectKeys(node.schema)) names.add(key);
  return names;
}

/** Every required key path present in `value`, for the delete-one-field sweep. */
export function requiredKeyPaths(schema: Schema, value: unknown): Path[] {
  const paths: Path[] = [];
  walk(schema, value, { requiredKey: (p) => paths.push(p) });
  return paths;
}
