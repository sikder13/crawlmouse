import { join } from 'node:path';
import ts from 'typescript';
import { format, resolveConfig } from 'prettier';
import { WEB_ROOT } from '../_lib/tokens-css';
// Data modules only: nothing here imports a component.
import { ProgressEventSchema, RECENT_FETCHES_IN_PROGRESS } from '../../../lib/v2/progress';
import { MOTION, LAYOUT_GAP_MS, LOG_LINE_GAP_MS, type MotionEntry } from '../../../lib/v2/motion';
import { INVENTORY } from '../../../lib/v2/view/inventory';
import { ADDED_TEXT, ADDITIONS, COPY_CHANGES } from '../../../lib/v2/copy-registry';
import { RECORDING_NAMES, recording, recordingSpec } from '../../../lib/v2/recordings';
import {
  enumValues,
  isNullable,
  objectShape,
  schemaType,
  unwrap,
} from '../../../../../packages/types/src/v2/introspect';

export const SPEC_22_PATH = join(WEB_ROOT, '..', '..', 'docs', 'specs', 'v2', '22-audit-flow.md');

/** A table cell: pipes escaped, line breaks flattened. */
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const table = (head: string[], rows: string[][]) =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
const code = (s: string) => `\`${s}\``;

type Schema = Parameters<typeof objectShape>[0];

/** A field's type as the contract names it: an enum's values, a nullable mark, or the zod kind. */
function fieldType(schema: Schema): string {
  const s = unwrap(schema);
  const kind = schemaType(s);
  const name =
    kind === 'enum'
      ? enumValues(s).join(' / ')
      : kind === 'object' || kind === 'union'
        ? 'contract shape'
        : kind;
  return isNullable(schema) ? `${name} or null` : name;
}

function contractSection(): string {
  const rows = ProgressEventSchema.options.map((o) => {
    const shape = objectShape(o as unknown as Schema);
    const fields = Object.entries(shape)
      .filter(([k]) => k !== 'type' && k !== 'at_ms')
      .map(([k, v]) => `${k}: ${fieldType(v)}`)
      .join('; ');
    return [code(o.shape.type.value), fields || '(none)', o.description ?? ''];
  });
  return [
    '## The progress-event contract',
    '',
    'From `apps/web/lib/v2/progress.ts`: the events the pipeline will stream while a check runs. Each also carries `at_ms`, milliseconds since the check started; events arrive in time order. The reducer there turns them into the state the crawl screen draws, and `toProgress` maps any state onto the CC-11 `Progress` snapshot, carrying the last ' +
      `${RECENT_FETCHES_IN_PROGRESS} fetches without identity or timing, which that snapshot does not hold.`,
    '',
    table(['Event', 'Fields', 'What it says'], rows),
  ].join('\n');
}

interface Field {
  path: string;
  type: string;
  doc: string;
}

/** The properties of the named interfaces, read through the TypeScript compiler, one level in. */
function readInterfaces(file: string, names: string[]): Map<string, Field[]> {
  const program = ts.createProgram([file], {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    resolveJsonModule: true,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`cannot read ${file}`);
  const out = new Map<string, Field[]>();
  const describe = (symbol: ts.Symbol, at: ts.Node, prefix: string, depth: number): Field[] => {
    const type = checker.getTypeOfSymbolAtLocation(symbol, at);
    const doc = ts.displayPartsToString(symbol.getDocumentationComment(checker));
    const field = {
      path: `${prefix}${symbol.name}`,
      type: checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation),
      doc,
    };
    const props = type.getProperties();
    const literal =
      depth < 1 &&
      props.length > 0 &&
      !type.isUnion() &&
      (type.flags & ts.TypeFlags.Object) !== 0 &&
      !checker.isArrayLikeType(type);
    return literal
      ? [
          { ...field, type: 'object' },
          ...props.flatMap((p) => describe(p, at, `${field.path}.`, depth + 1)),
        ]
      : [field];
  };
  ts.forEachChild(source, (node) => {
    if (ts.isInterfaceDeclaration(node) && names.includes(node.name.text)) {
      const type = checker.getTypeAtLocation(node);
      out.set(
        node.name.text,
        type.getProperties().flatMap((p) => describe(p, node, '', 0)),
      );
    }
  });
  for (const n of names) if (!out.has(n)) throw new Error(`${file} has no interface ${n}`);
  return out;
}

function viewModelSection(): string {
  const view = (f: string) => join(WEB_ROOT, 'lib', 'v2', 'view', f);
  const parts: [string, string, string][] = [
    ['Home', view('home.ts'), 'HomeView'],
    ['Result', view('result.ts'), 'ResultView'],
    ['Result door', view('result.ts'), 'DoorView'],
    ['Crawl, per frame', view('crawl.ts'), 'CrawlFrame'],
    ['Crawl, fixed for a check', view('crawl.ts'), 'CrawlContext'],
  ];
  const sections = parts.map(([title, file, name]) => {
    const fields = readInterfaces(file, [name]).get(name)!;
    return [
      `### ${title}: ${code(name)}`,
      '',
      table(
        ['Field', 'Type', 'Note'],
        fields.map((f) => [code(f.path), code(f.type), f.doc]),
      ),
    ].join('\n');
  });
  return [
    '## View models',
    '',
    'From `apps/web/lib/v2/view`, read through the TypeScript compiler. A screen receives one of these and nothing else from a fixture.',
    '',
    sections.join('\n\n'),
  ].join('\n');
}

function inventorySection(): string {
  return [
    '## Values that come from a check',
    '',
    'From `apps/web/lib/v2/view/inventory.ts`. `apps/web/__tests__/v2/perturbation.test.tsx` changes each field a row lists, one at a time, in a copy of a contract fixture, and requires each screen the row names to show the new value where it did not before; it also fails when a row lists a field, or a screen, that no change shows. Verify: `pnpm --filter @crawlmouse/web exec vitest run __tests__/v2/perturbation.test.tsx`.',
    '',
    table(
      ['Screens', 'Element', 'Read from'],
      INVENTORY.map((e) => [e.screens, e.element, code(e.field)]),
    ),
  ].join('\n');
}

function motionSection(): string {
  const tokens = (m: MotionEntry) =>
    [m.token?.duration, m.token?.easing]
      .filter(Boolean)
      .map((t) => code(t!))
      .join(', ');
  return [
    '## Motion',
    '',
    `From \`apps/web/lib/v2/motion.ts\`. The Web Animations read their timings from it; the two CSS transitions are pinned to it by \`apps/web/lib/v2/motion.test.ts\`. Under \`prefers-reduced-motion\` nothing animates (DESIGN-LOCK rule 13 would allow a cross-fade; these screens take the stricter reading); \`tests/visual/motion.spec.ts\` plays each recording to its end on a fake clock with and without it and requires the same final DOM. Log lines slide in at most once every ${LOG_LINE_GAP_MS} ms; the map takes a new layout at most once every ${LAYOUT_GAP_MS} ms.`,
    '',
    table(
      ['What moves', 'Trigger', 'Motion', 'Duration', 'Easing', 'Tokens'],
      (Object.values(MOTION) as MotionEntry[]).map((m) => [
        m.what,
        m.trigger,
        m.motion,
        m.duration_ms ? `${m.duration_ms} ms` : 'none',
        m.easing === 'none' ? 'none' : code(m.easing),
        tokens(m),
      ]),
    ),
  ].join('\n');
}

function recordingSection(): string {
  return [
    '## Recordings',
    '',
    'From `apps/web/lib/v2/recordings.ts`. None comes from the engine: each is synthesised from its fixture by `apps/web/lib/v2/synthesise.ts`, labelled `provenance: "synthesised"`, and checked against its check by `apps/web/lib/v2/synthesise.test.ts`.',
    '',
    table(
      ['Recording', 'Fixture', 'Check', 'Events', 'Covers', 'Moments it must pass through'],
      RECORDING_NAMES.map((name) => {
        const spec = recordingSpec(name);
        const rec = recording(name);
        return [
          code(name),
          code(spec.fixture),
          code(spec.check_id),
          String(rec.events.length),
          `${rec.until_ms} ms${rec.events.some((e) => e.type === 'ended') ? '' : ', still open'}`,
          spec.moments.map((m) => `${m.at_ms} ms, from ${m.source}`).join('; ') || 'none',
        ];
      }),
    ),
  ].join('\n');
}

function copySection(): string {
  return [
    '## Where a screen differs from its locked HTML',
    '',
    'From `apps/web/lib/v2/copy-registry.ts`. The lock comparisons apply each change to the locked text and then require equality; an entry that matches nothing fails.',
    '',
    table(
      ['Screen', 'Kind', 'Locked', 'Now', 'Why'],
      COPY_CHANGES.map((c) => [c.screen, c.kind, c.locked, c.rendered, c.source]),
    ),
    '',
    'What the brief adds, left out of the comparison:',
    '',
    table(
      ['Screen', 'Addition', 'Source'],
      [
        ...ADDITIONS.map((a) => [a.screen, a.what, a.source]),
        ...ADDED_TEXT.map((a) => [
          a.screen,
          `${a.what} (text matching ${code(String(a.pattern))})`,
          'CC-22 brief, scope 2',
        ]),
      ],
    ),
  ].join('\n');
}

export async function buildSpec22(): Promise<string> {
  const md = [
    '# SPEC 22 — audit flow screens',
    '',
    '> Generated by `pnpm --filter @crawlmouse/web exec tsx __tests__/v2/generate-spec.ts`. Do not edit it by hand: `apps/web/__tests__/v2/spec.test.ts` fails when this file differs from what the generator writes.',
    '',
    'Home, Crawl in progress and Result, rebuilt from the locked screens in `docs/design/v2/screens` on the CC-11 contract fixtures. They are development previews, listed in SPEC 21 under Preview pages. Every section below is read from the code it describes.',
    '',
    contractSection(),
    '',
    viewModelSection(),
    '',
    inventorySection(),
    '',
    motionSection(),
    '',
    recordingSection(),
    '',
    copySection(),
    '',
  ].join('\n');
  const options = (await resolveConfig(SPEC_22_PATH)) ?? {};
  return format(md, { ...options, parser: 'markdown' });
}
