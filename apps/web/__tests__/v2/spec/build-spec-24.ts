import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { WEB_ROOT } from '../_lib/tokens-css';
import { findCheck, fixesAsOf, fixture } from '../../../lib/v2/fixtures';
import { ADDITIONS, COPY_CHANGES } from '../../../lib/v2/copy-registry';
import { FIX_MAP_INVENTORY } from '../../../lib/v2/view/fix-map-inventory';
import { FRAMEWORK_LABELS } from '../../../lib/v2/view/fix';
import { FREE_FIXES, freeFixes } from '../../../lib/v2/view/free-fixes';
import { EXPLORER_SVG_MAX } from '../../../lib/v2/view/link-map';
import { EXPLORER_KEYS } from '../../../components/v2/screens/map/keys';
import { previewAllowed } from '../../../app/(v2-preview)/v2-preview/_preview/guard';
import { PREVIEWS } from '../../../app/(v2-preview)/v2-preview/_preview/registry';
import {
  FIX_SOURCES,
  fixIdOf,
  fixPreview,
  type FixVariant,
} from '../../../app/(v2-preview)/v2-preview/_preview/fixes';
import {
  MAP_SOURCES,
  mapPreview,
  type MapVariant,
} from '../../../app/(v2-preview)/v2-preview/_preview/maps';
import { SEGMENT_SOURCES } from '../../../app/(v2-preview)/v2-preview/_preview/segments';
import { BUDGET, EXPLORER, RUNS, WINDOW_MS } from '../../../../../tests/visual/budgets';
import { code, readInterfaces, table } from './build-spec-22';

export const SPEC_24_PATH = join(WEB_ROOT, '..', '..', 'docs', 'specs', 'v2', '24-fix-and-map.md');

const orange = (path: string) => String(PREVIEWS.find((p) => p.path === path)?.orange ?? 1);

function routeSection(): string {
  const fixes = (Object.keys(FIX_SOURCES) as FixVariant[]).map((v) => {
    const s = FIX_SOURCES[v];
    const f = fixture(s.fixture).fixes.find((x) => x.id === fixIdOf(v))!;
    return [
      code(s.path),
      code(s.fixture),
      code(s.check),
      `fix ${f.number}: ${f.title}`,
      fixPreview(v).kind,
      orange(s.path),
    ];
  });
  const maps = (Object.keys(MAP_SOURCES) as MapVariant[]).map((v) => {
    const s = MAP_SOURCES[v];
    const m = mapPreview(v);
    return [
      code(s.path),
      code(s.fixture),
      code(s.check),
      s.generated ? 'generated graph' : s.scope,
      `${m.nodes.length} pages, ${m.renderer}`,
      orange(s.path),
    ];
  });
  return [
    '## Preview pages',
    '',
    'From `apps/web/app/(v2-preview)/v2-preview/_preview/fixes.ts`, `maps.ts` and `registry.ts`. The fix pages are on Free; the kind is what the page shows of the fix.',
    '',
    table(['Path', 'Fixture', 'Check', 'Fix', 'Kind', 'Orange elements'], fixes),
    '',
    `The explorer draws SVG up to ${EXPLORER_SVG_MAX} pages and a canvas above (\`EXPLORER_SVG_MAX\`, \`lib/v2/view/link-map.ts\`).`,
    '',
    table(['Path', 'Fixture', 'Check', 'Drawing', 'Drawn', 'Orange elements'], maps),
  ].join('\n');
}

function freeSection(): string {
  const rows = (Object.keys(SEGMENT_SOURCES) as (keyof typeof SEGMENT_SOURCES)[]).map((v) => {
    const s = SEGMENT_SOURCES[v];
    const d = fixture(s.fixture);
    const check = findCheck(d, s.check);
    const free = freeFixes(d, check);
    return [
      code(s.fixture),
      code(s.check),
      String(fixesAsOf(d, check).length),
      free.map((f) => `fix ${f.number} (rank ${f.rank})`).join(', ') || 'none',
    ];
  });
  return [
    '## Which fixes Free opens',
    '',
    `One rule, \`freeFixes\` and \`isFreeFix\` in \`apps/web/lib/v2/view/free-fixes.ts\`: the first ${FREE_FIXES} of the audit’s live fixes in the order \`fixesAsOf\` gives (rank, then number). The Result page, the segments and the fix page import it; \`apps/web/__tests__/v2/free-fix-agreement.test.ts\` holds the three to the same answer on every finished check of every fixture. A fix Free does not open is built without reading its packet (\`apps/web/lib/v2/view/fix.ts\`), and \`tests/visual/production.spec.ts\` fetches the locked fix page from the production build and requires none of the packet in its HTML or its RSC payload.`,
    '',
    table(['Fixture', 'First audit', 'Live fixes', 'Free opens'], rows),
  ].join('\n');
}

function frameworkSection(): string {
  return [
    '## The framework switch',
    '',
    'From `FRAMEWORK_LABELS` in `apps/web/lib/v2/view/fix.ts`; the switch shows them in the order the packet’s `frameworks` lists them. The audit holds one packet, written for `packet.framework`; choosing another framework says the audit has no packet for it yet.',
    '',
    table(
      ['Framework', 'Shown as'],
      Object.entries(FRAMEWORK_LABELS).map(([k, v]) => [code(k), v]),
    ),
  ].join('\n');
}

function keyboardSection(): string {
  return [
    '## The explorer’s keyboard model',
    '',
    'From `apps/web/components/v2/screens/map/keys.ts`. The focus sits on a listbox of every drawn page, ordered by depth and then path, with `aria-activedescendant` naming the selected page; the map draws a ring on it and a polite status line names it. "List view" shows the list.',
    '',
    table(
      ['Key', 'Does'],
      EXPLORER_KEYS.map((k) => [code(k.key), k.does]),
    ),
  ].join('\n');
}

function guardSection(): string {
  const envs: [string, Record<string, string>][] = [
    ['`next dev`', { NODE_ENV: 'development' }],
    ['`next start`', { NODE_ENV: 'production' }],
    [
      '`next start`, `V2_PREVIEW_ON_NEXT_START=1`',
      { NODE_ENV: 'production', V2_PREVIEW_ON_NEXT_START: '1' },
    ],
    ['Vercel production', { NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production' }],
    [
      'Vercel preview, with the flag',
      { NODE_ENV: 'production', VERCEL_ENV: 'preview', V2_PREVIEW_ON_NEXT_START: '1' },
    ],
    ['`VERCEL` alone, in development', { NODE_ENV: 'development', VERCEL: '1' }],
  ];
  return [
    '## Where the previews answer',
    '',
    "`previewAllowed` in `apps/web/app/(v2-preview)/v2-preview/_preview/guard.ts`, evaluated for each row. Any value of `VERCEL` or `VERCEL_ENV` means a 404. The group renders on each request (`dynamic = 'force-dynamic'` in its layout), so the guard reads the running server’s environment. Verify: `pnpm --filter @crawlmouse/web exec vitest run __tests__/v2/preview-guard-env.test.ts`; on the production build, CI runs `tests/visual/vercel-guard.sh`.",
    '',
    table(
      ['Server', 'Previews'],
      envs.map(([name, env]) => [name, previewAllowed(env) ? 'served' : '404']),
    ),
  ].join('\n');
}

function budgetSection(): string {
  return [
    '## Performance budgets, on the production build',
    '',
    `From \`tests/visual/budgets.ts\`, which \`tests/visual/perf.spec.ts\` reads. CI runs it on \`next start\` after \`next build\` (VISUAL_SERVER=start, VISUAL_PERF=1, one worker). Each window is measured up to ${RUNS} times and judged on its best run.`,
    '',
    table(
      ['Window', 'Budget'],
      [
        [
          `The crawl screen, three windows of ${WINDOW_MS / 1000} s`,
          `no task over ${BUDGET.stallMs} ms; layout shift at most ${BUDGET.layoutShift}; 95th percentile frame at most ${BUDGET.p95FrameMs} ms; at most ${BUDGET.slowShare * 100}% of frames over ${BUDGET.slowFrameMs} ms; none over ${BUDGET.maxFrameMs} ms`,
        ],
        [
          `The explorer, ${code(EXPLORER.path)}, ${EXPLORER.ms / 1000} s, a step down the list every ${EXPLORER.stepMs} ms`,
          `no task over ${EXPLORER.frameMs} ms in the trace, and no frame over ${EXPLORER.frameMs} ms`,
        ],
      ],
    ),
  ].join('\n');
}

function viewModelSection(): string {
  const files: [string, string, string[]][] = [
    [
      'The fix page',
      'fix.ts',
      ['FixFrame', 'FixHead', 'BeforeAfterView', 'OpenFixPage', 'LockedFixPage', 'ResolvedFixPage'],
    ],
    ['The explorer', 'link-map.ts', ['MapNodeView', 'PageDetails', 'MapFilter', 'LinkMapView']],
  ];
  return [
    '## View models',
    '',
    'Read through the TypeScript compiler. A screen receives its view and nothing else from a fixture.',
    '',
    ...files.flatMap(([title, name, interfaces]) => {
      const fields = readInterfaces(join(WEB_ROOT, 'lib', 'v2', 'view', name), interfaces);
      return [
        `### ${title} (${code(`lib/v2/view/${name}`)})`,
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
      ];
    }),
  ].join('\n');
}

function inventorySection(): string {
  return [
    '## Values that come from a check',
    '',
    'From `apps/web/lib/v2/view/fix-map-inventory.ts`. `apps/web/__tests__/v2/fix-map-perturbation.test.tsx` changes each field a row lists, one at a time, in a copy of the bad-site fixture, and requires each page the row names to show the new value where it did not before; it fails when a row lists a field or a page that no change shows. Verify: `pnpm --filter @crawlmouse/web exec vitest run __tests__/v2/fix-map-perturbation.test.tsx`.',
    '',
    table(
      ['Pages', 'Element', 'Read from'],
      FIX_MAP_INVENTORY.map((e) => [e.pages.join(', '), e.element, code(e.fields.join(', '))]),
    ),
  ].join('\n');
}

function copySection(): string {
  const ours = (s: string) => s === 'fix' || s === 'link-map';
  return [
    '## Where a page differs from its locked HTML (FACTS over screen)',
    '',
    'From `apps/web/lib/v2/copy/fix.ts` and `link-map.ts`. The lock comparisons (`apps/web/__tests__/v2/fix.test.tsx`, `link-map.test.tsx`, and `tests/visual/copy.spec.ts` at both widths) apply each change to the locked text and then require equality; an entry that matches nothing fails.',
    '',
    table(
      ['Page', 'Kind', 'Locked', 'Now', 'Why'],
      COPY_CHANGES.filter((c) => ours(c.screen)).map((c) => [
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
      ADDITIONS.filter((a) => ours(a.screen)).map((a) => [a.screen, a.what, a.source]),
    ),
  ].join('\n');
}

export async function buildSpec24(): Promise<string> {
  const md = [
    '# SPEC 24 — the fix page and the link-map explorer',
    '',
    '> Generated by `pnpm --filter @crawlmouse/web exec tsx __tests__/v2/generate-spec.ts`. Do not edit it by hand: `apps/web/__tests__/v2/spec.test.ts` fails when this file differs from what the generator writes.',
    '',
    'The fix page (`docs/design/v2/screens/Final-Fix.dc.html`) and the link-map explorer (`Final-LinkMap.dc.html`), rebuilt on the CC-11 contract fixtures as development previews. Every section below is read from the code it describes.',
    '',
    routeSection(),
    '',
    freeSection(),
    '',
    frameworkSection(),
    '',
    keyboardSection(),
    '',
    guardSection(),
    '',
    budgetSection(),
    '',
    viewModelSection(),
    '',
    inventorySection(),
    '',
    copySection(),
    '',
  ].join('\n');
  const options = (await resolveConfig(SPEC_24_PATH)) ?? {};
  return format(md, { ...options, parser: 'markdown' });
}
