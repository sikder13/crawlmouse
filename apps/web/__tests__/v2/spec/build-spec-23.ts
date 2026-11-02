import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { format, resolveConfig } from 'prettier';
import { VerdictSchema } from '@crawlmouse/types/v2';
import { WEB_ROOT } from '../_lib/tokens-css';
// Data modules only: the verdict vocabulary and pill states are tables, not components.
import { VERDICTS } from '../../../components/v2/verdicts';
import { PILL_STATES } from '../../../components/v2/pill-states';
import { ADDITIONS, COPY_CHANGES } from '../../../lib/v2/copy-registry';
import { RECOMMENDATION_LABELS } from '../../../lib/v2/view/segment/fixes';
import { SIGNAL_CLASSES } from '../../../lib/v2/view/segment/signals';
import { SEGMENT_INVENTORY } from '../../../lib/v2/view/segment/inventory';
import { PREVIEWS } from '../../../app/(v2-preview)/v2-preview/_preview/registry';
import {
  HISTORY_SOURCES,
  SEGMENT_SOURCES,
} from '../../../app/(v2-preview)/v2-preview/_preview/segments';
import { code, readInterfaces, table } from './build-spec-22';

export const SPEC_23_PATH = join(WEB_ROOT, '..', '..', 'docs', 'specs', 'v2', '23-segments.md');

const SEGMENT_FILES: [title: string, file: string][] = [
  ['Every segment: the frame', 'frame.ts'],
  ['Every segment with fixes: the fixes block', 'fixes.ts'],
  ['Crawler access', 'access.ts'],
  ['Readable without JavaScript', 'nojs.ts'],
  ['Site structure', 'structure.ts'],
  ['Content an answer engine can quote', 'content.ts'],
  ['Agent-readiness signals', 'signals.ts'],
  ['Changes', 'changes.ts'],
];

/** The interfaces a module exports, in source order. */
function exportedInterfaces(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022);
  const names: string[] = [];
  ts.forEachChild(source, (node) => {
    if (
      ts.isInterfaceDeclaration(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      names.push(node.name.text);
    }
  });
  return names;
}

function viewModelSection(): string {
  const sections = SEGMENT_FILES.map(([title, name]) => {
    const file = join(WEB_ROOT, 'lib', 'v2', 'view', 'segment', name);
    const interfaces = exportedInterfaces(file);
    const fields = readInterfaces(file, interfaces);
    return [
      `### ${title} (${code(`lib/v2/view/segment/${name}`)})`,
      '',
      ...interfaces.flatMap((i) => [
        `#### ${code(i)}`,
        '',
        table(
          ['Field', 'Type', 'Note'],
          fields.get(i)!.map((f) => [code(f.path), code(f.type), f.doc]),
        ),
        '',
      ]),
    ].join('\n');
  });
  return [
    '## View models',
    '',
    'Every interface the segment view modules export, read through the TypeScript compiler. A segment screen receives its view and nothing else from a fixture.',
    '',
    sections.join('\n\n'),
  ].join('\n');
}

function verdictSection(): string {
  const blocking = ['disallowed_by_robots', 'blocked_by_ua_rule'];
  return [
    '## Verdicts and their phrases',
    '',
    'From `apps/web/components/v2/verdicts.ts` and `pill-states.ts`, in the contract’s order. The phrase sits beside every cell of the crawler matrix; a verdict known from robots.txt alone (`allowed`, `declared`) adds “by robots.txt” (FACTS B2). `apps/web/__tests__/v2/verdict-copy-guard.test.tsx` renders every segment page for every fixture and fails if “blocked” appears beside any verdict but the two marked here, or if a verdict lacks its phrase or glyph.',
    '',
    table(
      ['Verdict', 'Glyph', 'Phrase', 'Says “blocked”', 'Phrase set by'],
      VerdictSchema.options.map((v) => [
        code(v),
        PILL_STATES[VERDICTS[v].state].glyph ?? 'none',
        VERDICTS[v].label,
        blocking.includes(v) ? 'yes' : 'no',
        VERDICTS[v].labelFromFacts ? 'FACTS' : 'proposed here (R7 §4 design item)',
      ]),
    ),
  ].join('\n');
}

function recommendationSection(): string {
  return [
    '## Recommendation classes',
    '',
    'From `apps/web/lib/v2/view/segment/fixes.ts` (each fix carries its class in the contract) and `signals.ts` (the contract gives a signal no class; the table there is proposed until `SignalResult.recommendation_class` exists).',
    '',
    table(
      ['Class', 'Shown as'],
      Object.entries(RECOMMENDATION_LABELS).map(([k, v]) => [code(k), v]),
    ),
    '',
    table(
      ['Signal', 'Class (proposed)'],
      Object.entries(SIGNAL_CLASSES).map(([k, v]) => [code(k), code(v)]),
    ),
  ].join('\n');
}

function routeSection(): string {
  const source = (path: string) => {
    const history = Object.entries(HISTORY_SOURCES).find(([n]) => path.endsWith(`/${n}`));
    if (history) return [history[1].fixture, history[1].check];
    const variant = Object.entries(SEGMENT_SOURCES).find(
      ([, s]) => s.suffix && path.endsWith(s.suffix),
    );
    const s = variant ? variant[1] : SEGMENT_SOURCES['bad-site'];
    return [s.fixture, s.check];
  };
  return [
    '## Preview pages',
    '',
    'From `apps/web/app/(v2-preview)/v2-preview/_preview/registry.ts` and `segments.ts`: each segment on each fixture’s first audit (the check its Result preview shows, so a door and its segment agree), and Changes on two later checks.',
    '',
    table(
      ['Path', 'Name', 'Fixture', 'Check', 'Orange elements'],
      PREVIEWS.filter((p) => p.path.includes('/screens/segment/')).map((p) => {
        const [fixture, check] = source(p.path);
        return [code(p.path), p.name, code(fixture!), code(check!), String(p.orange ?? 1)];
      }),
    ),
  ].join('\n');
}

function inventorySection(): string {
  return [
    '## Values that come from a check',
    '',
    'From `apps/web/lib/v2/view/segment/inventory`. `apps/web/__tests__/v2/segment-perturbation.test.tsx` changes each field a row lists, one at a time, in a copy of a contract fixture, and requires each page the row names to show the new value where it did not before; it fails when a row lists a field or a page that no change shows. Verify: `pnpm --filter @crawlmouse/web exec vitest run __tests__/v2/segment-perturbation.test.tsx`.',
    '',
    table(
      ['Pages', 'Element', 'Read from'],
      SEGMENT_INVENTORY.map((e) => [e.segments.join(', '), e.element, code(e.fields.join(', '))]),
    ),
  ].join('\n');
}

function copySection(): string {
  const segment = (s: string) => s.startsWith('segment-');
  return [
    '## Where a page differs from its locked HTML (FACTS over screen)',
    '',
    'From `apps/web/lib/v2/copy/segment-*.ts`. The lock comparisons apply each change to the locked text and then require equality; an entry that matches nothing fails.',
    '',
    table(
      ['Page', 'Kind', 'Locked', 'Now', 'Why'],
      COPY_CHANGES.filter((c) => segment(c.screen)).map((c) => [
        c.screen,
        c.kind,
        c.locked,
        c.rendered || '(removed)',
        c.source,
      ]),
    ),
    '',
    'What the brief adds, left out of the comparison:',
    '',
    table(
      ['Page', 'Addition', 'Source'],
      ADDITIONS.filter((a) => segment(a.screen)).map((a) => [a.screen, a.what, a.source]),
    ),
  ].join('\n');
}

export async function buildSpec23(): Promise<string> {
  const md = [
    '# SPEC 23 — segment pages',
    '',
    '> Generated by `pnpm --filter @crawlmouse/web exec tsx __tests__/v2/generate-spec.ts`. Do not edit it by hand: `apps/web/__tests__/v2/spec.test.ts` fails when this file differs from what the generator writes.',
    '',
    'The six pages a reader opens from the Result overview’s doors (Crawler access, Readable without JavaScript, Site structure, Content an answer engine can quote, Agent-readiness signals, Changes), rebuilt from the locked screens in `docs/design/v2/screens` on the CC-11 contract fixtures. They are development previews. Every section below is read from the code it describes.',
    '',
    routeSection(),
    '',
    verdictSection(),
    '',
    recommendationSection(),
    '',
    viewModelSection(),
    '',
    inventorySection(),
    '',
    copySection(),
    '',
  ].join('\n');
  const options = (await resolveConfig(SPEC_23_PATH)) ?? {};
  return format(md, { ...options, parser: 'markdown' });
}
