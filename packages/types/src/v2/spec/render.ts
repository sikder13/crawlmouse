/**
 * Renders docs/specs/v2/11-type-contract.md from the schemas, the entity docs and the fixtures.
 * Every table is produced by iterating the data it describes; the sentences around them are fixed text
 * that names no measured value. Tables are padded the way Prettier pads them. `table()` throws on the
 * cells it is known to disagree with Prettier about (anything outside printable ASCII, a pipe, `*`,
 * `__`); the repository's Prettier check in CI is what verifies the result.
 */
import type { z } from 'zod';
import { ENTITIES } from '../entities.js';
import { REGISTRY_ONLY_ENUMS, V1_PINNED_ENUMS, V2_FIXTURE_ENUMS } from '../enums.js';
import type { FixtureDataset } from '../fixture.js';
import {
  arrayElement,
  enumValues,
  isNullable,
  literalValues,
  objectShape,
  schemaFormat,
  schemaType,
  unionOptions,
  unwrap,
} from '../introspect.js';
import { v2Registry } from '../registry.js';
import { RULES } from '../rules.js';

type Schema = z.core.$ZodType;

interface Row {
  path: string;
  type: string;
  nullable: boolean;
  variant: string;
}

const FORMATS: Record<string, string> = {
  uuid: 'uuid',
  datetime: 'timestamp',
  date: 'date',
  url: 'url',
  email: 'email',
  safeint: 'integer',
};

function typeName(schema: Schema): string {
  const s = unwrap(schema);
  const kind = schemaType(s);
  switch (kind) {
    case 'enum':
      return v2Registry.get(s)?.id ?? 'enum';
    case 'string':
    case 'number':
      return FORMATS[schemaFormat(s) ?? ''] ?? kind;
    case 'literal':
      return literalValues(s)
        .map((v) => JSON.stringify(v))
        .join(' or ');
    case 'array':
      return `${typeName(arrayElement(s)!)}[]`;
    case 'union':
      return isObjectUnion(s)
        ? `one of ${unionOptions(s).length} variants`
        : unionOptions(s).map(typeName).join(' or ');
    default:
      return kind;
  }
}

function isObjectUnion(schema: Schema): boolean {
  const s = unwrap(schema);
  return (
    schemaType(s) === 'union' && unionOptions(s).every((o) => schemaType(unwrap(o)) === 'object')
  );
}

/** "kind = marked_done": the literal field that tells a union's object variants apart. */
function variantLabel(option: Schema): string {
  for (const [key, field] of Object.entries(objectShape(option))) {
    if (schemaType(field) === 'literal') return `${key} = ${String(literalValues(field)[0])}`;
  }
  return 'variant';
}

function rows(schema: Schema, prefix: string, variant: string): Row[] {
  const s = unwrap(schema);
  if (isObjectUnion(s)) {
    return unionOptions(s).flatMap((o) => rows(o, prefix, variantLabel(o)));
  }
  if (schemaType(s) !== 'object') return [];
  return Object.entries(objectShape(s)).flatMap(([key, field]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const here: Row = { path, type: typeName(field), nullable: isNullable(field), variant };
    return [here, ...children(field, path, variant)];
  });
}

function children(field: Schema, path: string, variant: string): Row[] {
  const s = unwrap(field);
  const kind = schemaType(s);
  if (kind === 'object' || isObjectUnion(s)) return rows(s, path, variant);
  if (kind === 'array') {
    const el = unwrap(arrayElement(s)!);
    if (schemaType(el) === 'object' || isObjectUnion(el)) return rows(el, `${path}[]`, variant);
  }
  return [];
}

/** A Markdown table in Prettier's layout: every column padded to its widest cell, at least 3. */
export function table(header: string[], body: string[][]): string {
  for (const cell of [...header, ...body.flat()]) {
    if (!/^[\x20-\x7e]*$/.test(cell) || /[|*]|__/.test(cell)) {
      throw new Error(`table(): cell Prettier would rewrite: ${JSON.stringify(cell)}`);
    }
  }
  const widths = header.map((h, i) => Math.max(3, h.length, ...body.map((r) => r[i]!.length)));
  const line = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(widths[i]!)).join(' | ')} |`;
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n');
}

const code = (s: string) => `\`${s}\``;

function entitySection(entity: (typeof ENTITIES)[number]): string {
  const all = rows(entity.schema, '', '');
  const hasVariants = all.some((r) => r.variant !== '');
  const header = ['Field', 'Type', 'Null', ...(hasVariants ? ['Variant'] : []), 'Added for'];
  const body = all.map((r) => [
    code(r.path),
    code(r.type),
    r.nullable ? 'yes' : 'no',
    ...(hasVariants ? [r.variant === '' ? '' : code(r.variant)] : []),
    entity.addedFor[r.path] ?? '',
  ]);
  const screens = table(
    ['Screen', 'Shows'],
    entity.readBy.map((r) => [r.screen, `"${r.evidence}"`]),
  );
  const where = entity.collection
    ? `Fixture collection: ${code(entity.collection)}.`
    : 'Seed data: `packages/engine/src/v2/crawler-registry.ts`.';
  return [`### ${entity.name}`, where, screens, table(header, body)].join('\n\n');
}

function enumSection(): string {
  const groups: [string, Record<string, Schema>][] = [
    ['every value in a fixture', V2_FIXTURE_ENUMS],
    ['pinned to v1 or the engine', V1_PINNED_ENUMS],
    ['registry seed only', REGISTRY_ONLY_ENUMS],
  ];
  const body = groups.flatMap(([group, enums]) =>
    Object.entries(enums).map(([name, schema]) => [
      code(name),
      group,
      enumValues(schema).join(', '),
    ]),
  );
  return table(['Enum', 'Coverage', 'Values'], body);
}

function rulesSection(): string {
  const body = Object.entries(RULES).map(([id, r]) => [
    code(id),
    r.message,
    r.twoWay ? 'both ways' : 'one way',
  ]);
  return table(['Rule', 'Message', 'Breaks'], body);
}

function addedSection(): string {
  const body = ENTITIES.flatMap((e) =>
    Object.entries(e.addedFor).map(([path, source]) => [e.name, code(path), source]),
  );
  return table(['Entity', 'Field', 'Added for'], body);
}

const COLLECTIONS = [
  'accounts',
  'seats',
  'sites',
  'checks',
  'page_results',
  'link_edges',
  'access_tests',
  'fixes',
  'fix_events',
  'changes',
  'alert_rules',
  'reports',
] as const;

function fixtureSection(fixtures: Record<string, FixtureDataset>): string {
  const body = Object.entries(fixtures).map(([name, data]) => [
    code(`${name}.json`),
    data.as_of,
    ...COLLECTIONS.map((c) => String(data[c].length)),
    String(data.engine_derived.length),
  ]);
  return table(['Fixture', 'as_of', ...COLLECTIONS, 'engine_derived'], body);
}

export function renderContractSpec(fixtures: Record<string, FixtureDataset>): string {
  return [
    '# 11 — The v2 type contract (CC-11)',
    '> Generated from `packages/types/src/v2` by `pnpm --filter @crawlmouse/types exec tsx src/v2/spec/write.ts`. ' +
      'Do not edit by hand: `src/v2/spec.test.ts` fails when this file and the schemas disagree.',
    '## Entities',
    'Each entity lists the screens that read it, with a phrase the contract test finds on that screen, ' +
      'then every field. "Added for" names what required a field beyond the CC-11 brief: a locked screen, ' +
      '`FACTS` (`docs/design/v2/FACTS-proposed.md`), or `brief` (needed to express a state the brief names, ' +
      'or carried over from existing code the brief says to reuse). ' +
      'An empty cell means the field is an id or foreign key, or one the CC-11 brief names; the brief is quoted in the pull request that added this file.',
    ...ENTITIES.map(entitySection),
    '## Fields added beyond the brief',
    addedSection(),
    '## Rules',
    'Every rule a schema enforces beyond shape, from `rules.ts`. A two-way rule ("X exactly when Y") ' +
      'can break in either direction, and has test cases that break it each way.',
    rulesSection(),
    '## Enums',
    enumSection(),
    '## Open items for the engine stream',
    [
      '- How `template_key` is derived. The screens group pages by template (`/collections/{slug}`); ' +
        "the v1 engine's `templateKeyFor` keeps short slugs literal (`/collections/tents`), so it does " +
        'not produce that grouping as it stands. See `TemplateKeySchema` in `common.ts`.',
      "- AI readability's letter scale. No document defines it, so the contract does not pin AI " +
        'letters to scores; Technical SEO letters are pinned to `scoreToLetter`. Choosing the scale ' +
        'moves band boundaries, which OPERATING-RULES §5 Amendment 2 treats as re-curving.',
      '- Where the result-email recipient is kept until the check finishes. It is deliberately not on ' +
        '`Check`, which public reports and the API read; a private delivery record belongs to the stream ' +
        'that sends the email.',
      '- Every value a fixture lists in `engine_derived` is regenerated by the engine at CC-19.',
    ].join('\n'),
    '## Fixtures',
    'Records per collection in each frozen fixture under `apps/web/lib/fixtures/v2/`. ' +
      '`engine_derived` counts the JSON pointers to values FACTS marks ENGINE-DERIVED.',
    fixtureSection(fixtures),
  ]
    .join('\n\n')
    .concat('\n');
}
