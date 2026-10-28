import { join } from 'node:path';
import ts from 'typescript';
import { format, resolveConfig } from 'prettier';
import { parseTokens, tokenMap, WEB_ROOT, type TokenDecl } from '../_lib/tokens-css';
// Data modules only: the components themselves import CSS, which this script does not load.
import { EVIDENCE_CLASSES, VERDICTS } from '../../../components/v2/verdicts';
import { PILL_STATES } from '../../../components/v2/pill-states';
import { PREVIEWS } from '../../../app/(v2-preview)/v2-preview/_preview/registry';

export const SPEC_PATH = join(WEB_ROOT, '..', '..', 'docs', 'specs', 'v2', '21-design-system.md');
const INDEX = join(WEB_ROOT, 'components', 'v2', 'index.ts');

/** A table cell: pipes escaped, line breaks flattened. */
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const table = (head: string[], rows: string[][]) =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');

function tokenSection(): string {
  const decls = parseTokens();
  const dark = tokenMap(decls, 'dark-media');
  const rows = decls
    .filter((d: TokenDecl) => d.block === 'root')
    .map((d) => [
      `\`${d.name}\``,
      `\`${d.value}\``,
      dark.has(d.name) ? `\`${dark.get(d.name)?.value}\`` : '(same)',
      d.source ?? '',
    ]);
  return [
    '## Tokens',
    '',
    'From `apps/web/styles/v2/tokens.css`. The source column is the comment on each declaration; `apps/web/__tests__/v2/tokens.test.ts` compares each `base`, `base.css`, `screen` and `brand` value with the source it names.',
    '',
    table(['Token', 'Light', 'Dark', 'Source'], rows),
  ].join('\n');
}

interface ComponentDoc {
  name: string;
  summary: string;
  props: { name: string; type: string; optional: boolean; doc: string }[];
}

/** The components exported from components/v2/index.ts, read through the TypeScript compiler. */
function readComponents(): ComponentDoc[] {
  const program = ts.createProgram([INDEX], {
    jsx: ts.JsxEmit.Preserve,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(INDEX);
  if (!source) throw new Error('cannot read components/v2/index.ts');
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error('components/v2/index.ts has no exports');

  const docs: ComponentDoc[] = [];
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    if (!(symbol.flags & ts.SymbolFlags.Function) || !/^[A-Z]/.test(exported.name)) continue;
    const decl = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!decl) continue;
    const signature = checker.getSignaturesOfType(
      checker.getTypeOfSymbolAtLocation(symbol, decl),
      ts.SignatureKind.Call,
    )[0];
    const param = signature?.getParameters()[0];
    const props = param
      ? checker
          .getTypeOfSymbolAtLocation(param, decl)
          .getProperties()
          .map((p) => ({
            name: p.name,
            type: checker.typeToString(
              checker.getTypeOfSymbolAtLocation(p, decl),
              undefined,
              ts.TypeFormatFlags.NoTruncation,
            ),
            optional: Boolean(p.flags & ts.SymbolFlags.Optional),
            doc: ts.displayPartsToString(p.getDocumentationComment(checker)),
          }))
      : [];
    docs.push({
      name: exported.name,
      summary: ts.displayPartsToString(symbol.getDocumentationComment(checker)),
      props,
    });
  }
  return docs.sort((a, b) => a.name.localeCompare(b.name));
}

function componentSection(): string {
  const parts = [
    '## Components',
    '',
    'Exported from `apps/web/components/v2/index.ts`. Summaries and prop notes are the components’ own doc comments.',
  ];
  for (const c of readComponents()) {
    parts.push('', `### ${c.name}`, '', c.summary || '(no doc comment)');
    if (c.props.length) {
      parts.push(
        '',
        table(
          ['Prop', 'Type', 'Required', 'Note'],
          c.props.map((p) => [`\`${p.name}\``, `\`${p.type}\``, p.optional ? 'no' : 'yes', p.doc]),
        ),
      );
    }
  }
  return parts.join('\n');
}

function verdictSection(): string {
  return [
    '## Verdicts and evidence',
    '',
    'From `apps/web/components/v2/verdicts.ts`. A row marked proposed is not yet set by `docs/design/v2/FACTS-proposed.md`.',
    '',
    table(
      ['Verdict', 'Pill', 'Glyph', 'Label', 'Mapping'],
      Object.entries(VERDICTS).map(([k, v]) => [
        `\`${k}\``,
        v.state,
        PILL_STATES[v.state].glyph ?? '(none)',
        v.label,
        v.locked ? 'locked' : 'proposed',
      ]),
    ),
    '',
    table(
      ['Evidence class', 'Meaning'],
      Object.entries(EVIDENCE_CLASSES).map(([k, v]) => [`\`${k}\``, v]),
    ),
  ].join('\n');
}

function previewSection(): string {
  return [
    '## Preview pages',
    '',
    'From `apps/web/app/(v2-preview)/v2-preview/_preview/registry.ts`. They are served by `next dev` only: when `NODE_ENV` is `production` the group layout and each page call `previewOnly()`, which returns a 404, and `apps/web/__tests__/v2/preview-guard.test.ts` calls every page under that setting. The visual harness in `tests/visual` captures each one at 1280 and 390 pixels, light and dark; `tests/visual/README.md` says how to run it and how to update a baseline.',
    '',
    table(
      ['Page', 'Path', 'Kind'],
      PREVIEWS.map((p) => [p.name, `\`${p.path}\``, p.kind]),
    ),
  ].join('\n');
}

/** The whole spec, formatted the way Prettier formats Markdown in this repo. */
export async function buildSpec(): Promise<string> {
  const md = [
    '# SPEC 21 — v2 design system',
    '',
    '> Generated by `pnpm --filter @crawlmouse/web exec tsx __tests__/v2/generate-spec.ts`. Do not edit it by hand: `apps/web/__tests__/v2/spec.test.ts` fails when this file differs from what the generator writes.',
    '',
    'The v2 design system ports the locked design in `docs/design/v2` (layouts, spacing, component shapes and the design rules in `DESIGN-LOCK-v1.md`) onto the live brand: the `CrawlmouseMark`, the `crawl` + orange `mouse` wordmark, and the Fraunces, Geist and Geist Mono typefaces from `apps/web/lib/fonts.ts`, which replace IBM Plex. Accent orange is `BRAND.peach` from `apps/web/lib/brand.ts`.',
    '',
    tokenSection(),
    '',
    componentSection(),
    '',
    verdictSection(),
    '',
    previewSection(),
    '',
  ].join('\n');
  const options = (await resolveConfig(SPEC_PATH)) ?? {};
  return format(md, { ...options, parser: 'markdown' });
}
