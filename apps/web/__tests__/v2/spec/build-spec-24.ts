import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { WEB_ROOT } from '../_lib/tokens-css';
import { FixTypeSchema } from '@crawlmouse/types/v2';
import { FIXTURE_NAMES, findCheck, fixesAsOf, fixture } from '../../../lib/v2/fixtures';
import { ADDITIONS, COPY_CHANGES } from '../../../lib/v2/copy-registry';
import { FIX_MAP_INVENTORY } from '../../../lib/v2/view/fix-map-inventory';
import { fixView, FRAMEWORK_LABELS } from '../../../lib/v2/view/fix';
import { FREE_FIXES, freeFixes } from '../../../lib/v2/view/free-fixes';
import { noPacketLine } from '../../../lib/v2/view/no-packet';
import { noPacketReason } from '../../../lib/v2/view/packet-reason';
import { packetBodies, PROMPT_TITLE_LABEL } from '../../../lib/v2/view/segment/fixes';
import { withSee } from '../../../lib/v2/view/test-support/multi-body';
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
import {
  SEGMENT_PREVIEWS,
  SEGMENT_SOURCES,
} from '../../../app/(v2-preview)/v2-preview/_preview/segments';
import { RESULT_PREVIEWS } from '../../../app/(v2-preview)/v2-preview/_preview/screens';
import type { ResultView } from '../../../lib/v2/view/result';
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

function linkSection(): string {
  const result = RESULT_PREVIEWS['bad-site']() as ResultView;
  const structure = SEGMENT_PREVIEWS.structure('bad-site');
  const map = mapPreview('bad-site');
  const fix = fixPreview('bad-site');
  const rows: [string, string, string][] = [
    ['Result', '“Open the fix”', result.first.kind === 'fix' ? result.first.href : '(none)'],
    ...result
      .fixes!.rows.filter((r) => r.open)
      .map((r) => ['Result', `“Open” beside ${r.title}`, r.href] as [string, string, string]),
    ['Result', 'the map door', result.map.href],
    ['Site structure', `“${structure.map!.explore}”`, structure.map!.exploreHref],
    ['Site structure', '“Open in the explorer”', structure.orphans.explorerHref],
    ['Link map', `“${map.explore!.label}”`, map.explore!.href],
    ['Link map', `“${map.frame.next.label}”`, map.frame.next.href],
    ['Fix', `“${fix.frame.back.label}”`, fix.frame.back.href],
    ['Fix', `“${fix.frame.next!.label}”`, fix.frame.next!.href],
  ];
  return [
    '## Where the pages link',
    '',
    'Read from the bad site’s previews. The locked Final-Result links its first fix to the Crawler access segment; here it opens the fix’s own page, which this spec adds. A fix with no preview page links to “#”.',
    '',
    table(
      ['Page', 'Link', 'Opens'],
      rows.map(([p, l, h]) => [p, l, code(h)]),
    ),
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
    `One rule, \`freeFixes\` and \`isFreeFix\` in \`apps/web/lib/v2/view/free-fixes.ts\`: the first ${FREE_FIXES} of the audit’s live fixes in the order \`fixesAsOf\` gives (rank, then number). The Result page, the segments and the fix page import it; \`apps/web/__tests__/v2/free-fix-agreement.test.ts\` holds them to the same answer: the segments and the fix page on every finished or partial check of every fixture, the Result page on each graded first audit, the checks it shows. A fix Free does not open is built without reading its packet (\`apps/web/lib/v2/view/fix.ts\`), and \`tests/visual/production.spec.ts\` fetches the locked fix page from the production build and requires none of the packet in its HTML or its RSC payload.`,
    '',
    table(['Fixture', 'First audit', 'Live fixes', 'Free opens'], rows),
  ].join('\n');
}

function frameworkSection(): string {
  const packets = FIXTURE_NAMES.flatMap((name) => fixture(name).fixes).flatMap((f) =>
    f.packet ? [f.packet] : [],
  );
  const several = packets.filter((p) => packetBodies(p).length > 1).length;
  const variants = Object.keys(FIX_SOURCES) as FixVariant[];
  const switched = variants.filter((v) => {
    const view = fixPreview(v);
    return view.kind === 'open' && view.switcher !== null;
  }).length;
  return [
    '## The framework switch',
    '',
    'A packet holds a body for its own framework and, in `packets`, one for each other framework it was written for. `packetBodies` in `apps/web/lib/v2/view/segment/fixes.ts` lists them, the packet’s own first; the fix page’s view holds a block and a prompt for each, and the switch has one toggle per body, named from `FRAMEWORK_LABELS` in `apps/web/lib/v2/view/fix.ts`. The switch is built from the bodies and not from `packet.frameworks`, so a framework listed there without a body is not offered, and a packet with one body has no switch. Choosing a framework shows that body’s block, and “Copy as a prompt” and “Download as .md” hand over that body’s prompt. The switch makes no request: an open fix’s bodies are in the page’s view. A locked fix’s view is built without reading its packet, so it holds none of them.',
    '',
    `Of the ${packets.length} packets in the contract fixtures, ${several} ${several === 1 ? 'holds' : 'hold'} more than one body, and ${switched} of the ${variants.length} fix previews ${switched === 1 ? 'shows' : 'show'} the switch. The tests of the switch give a fixture packet hand-made bodies (\`apps/web/lib/v2/view/test-support/multi-body.ts\`). Verify: \`pnpm --filter @crawlmouse/web exec vitest run lib/v2/view/fix.test.ts __tests__/v2/explorer.dom.test.tsx __tests__/v2/fix.test.tsx\`.`,
    '',
    table(
      ['Framework', 'Shown as'],
      Object.entries(FRAMEWORK_LABELS).map(([k, v]) => [code(k), v]),
    ),
    '',
    '### Which stack a body says it is written for',
    '',
    '`writtenFor` in `apps/web/lib/v2/view/fix.ts`. “Your stack as detected” is said when the body’s framework is the one the engine’s `frameworkOf` (`packages/engine/src/v2/packets/stack.ts`) gives for the check’s stack: the detected front end’s `framework`, or WordPress or Webflow when that is the CMS and no front end was detected. The front end’s name is not read. Each row below is a case of `lib/v2/view/fix.test.ts`.',
    '',
    table(
      ['The body', 'The check’s stack', 'The page says'],
      [
        [
          'for a named framework',
          'gives that framework',
          'Written for your stack as detected: (the stack).',
        ],
        [
          'for a named framework',
          'gives another, or none',
          'Written for (the framework); the audit detected (the stack).',
        ],
        [
          'for any stack, the packet’s own',
          'gives a named framework',
          'Written for any stack; the audit detected (the stack) and has no steps specific to it for this fix.',
        ],
        [
          'for any stack, the packet’s own',
          'has a front end no packet framework names',
          'Written for any stack; the audit detected (the stack), which has no steps of its own.',
        ],
        [
          'for any stack, the packet’s own',
          'has a CMS and no front end (Shopify among them)',
          'Written for any stack: the audit detected (the stack), not which front end the site runs.',
        ],
        [
          'for any stack, the packet’s own',
          'was not detected',
          'Written for any stack: the audit did not detect yours.',
        ],
        ['for any stack, chosen in the switch', 'any', 'Written for any stack.'],
      ],
    ),
    '',
    'The last three of the packet’s own cases add “If yours is listed under “Choose your stack”, choose it.” when the page has a switch.',
    '',
    '### The packet route',
    '',
    '`GET /api/fixes/[id]/packet` (`packet` in `apps/web/lib/v2/account/fixes.ts`) answers `{packet, prompt}`: the stored packet and the prompt of its own framework’s body. With `?framework=` it answers `{body, prompt}` for the body written for that framework, and 404 `no_packet_for_framework` for a value the packet holds no body for. The tier’s 402 is decided first, so a fix the tier does not open answers 402 whether or not it has a packet; then the 404 `no_packet`; both before the framework is looked at. Verify: `pnpm --filter @crawlmouse/web exec vitest run "app/api/fixes/[id]/packet/route.test.ts"`.',
  ].join('\n');
}

function noPacketSection(): string {
  const types = FixTypeSchema.options;
  const reasons = types.map((t) => [t, noPacketReason(t)] as const);
  const none = reasons.filter(([, r]) => r !== null);
  return [
    '## A fix with no packet',
    '',
    `An open fix whose \`packet\` is null shows one sentence in the packet’s place, on the fix page and in a segment’s open fix (\`noPacketLine\` in \`apps/web/lib/v2/view/no-packet.ts\`). The reason is read from the engine’s packet registry (\`noPacketReason\` in \`apps/web/lib/v2/view/packet-reason.ts\`). Of the ${types.length} fix types, the registry has a builder for ${types.length - none.length} and a reason for ${none.length}.`,
    '',
    table(
      ['The fix type’s registry entry', 'The sentence'],
      [
        ['a builder (the stored fix has no packet all the same)', noPacketLine(null)],
        ['no packet, with a reason', noPacketLine('(the engine’s reason)')],
      ],
    ),
    ...(none.length
      ? [
          '',
          table(
            ['Fix type', 'The engine’s reason'],
            none.map(([t, r]) => [code(t), r!]),
          ),
        ]
      : []),
    '',
    'The prompt and the blocks put each packet string and the fix’s title on one line (`oneLine` in `apps/web/lib/v2/packet-text.ts`), so a packet stored with a line break or a control character in a string adds no line to what is copied. Verify: `pnpm --filter @crawlmouse/web exec vitest run lib/v2/view/segment/fixes.property.test.ts lib/v2/packet-text.test.ts`.',
  ].join('\n');
}

function verifyLayersSection(): string {
  // No contract fixture's packet has a readable command, so the example gives one a hand-made one.
  const withOne = FIXTURE_NAMES.flatMap((name) => fixture(name).fixes).filter(
    (f) => f.packet !== null && f.packet.verify.see !== null,
  ).length;
  const source = FIX_SOURCES['bad-site'];
  const d = structuredClone(fixture(source.fixture));
  const f = d.fixes.find((x) => x.id === fixIdOf('bad-site'))!;
  f.packet = withSee(f.packet!);
  const view = fixView(d, source.check, f.id, { asFirstSeen: source.asFirstSeen });
  if (view.kind !== 'open' || !view.packet) throw new Error('the bad site’s fix opens');
  const body = view.packet.bodies[0]!;
  const after = (lines: string[], from: (l: string) => boolean) =>
    lines.filter((_, i) => i >= lines.findIndex(from));
  const block = after(body.block.split('\n'), (l) => l === 'Verify');
  const prompt = after(body.prompt.split('\n'), (l) => l.startsWith('Verify'));
  return [
    '## The two verify layers',
    '',
    'A packet body’s `verify.see` is a short command that prints the evidence, with what it prints today and after the fix (`{ command, today, after }`), or null (owner rulings 1 and Q8). Where it is not null, the block (`packetBlock` in `apps/web/lib/v2/view/fix.ts`), the segment’s open fix and the prompt (`verifyLines` in `apps/web/lib/v2/view/segment/fixes.ts`) show two layers: “See it”, then “Exact check” with the strict command. “Download as .md” saves the prompt. Where it is null, the verify section is the strict command and what to expect, as before.',
    '',
    `Of the packets in the contract fixtures, ${withOne} ${withOne === 1 ? 'has' : 'have'} a readable command. The example below is the bad site’s fix ${f.number} with a hand-made one (\`withSee\` in \`apps/web/lib/v2/view/test-support/multi-body.ts\`): first the block’s Verify section, then the prompt’s.`,
    '',
    '```text',
    ...block,
    '```',
    '',
    '```text',
    ...prompt,
    '```',
    '',
    'On the fix page the strict command (the view’s `exactLine`) is one unwrapped line in a strip that scrolls sideways (`ScrollRegion`, a named tab stop while the command overflows it); the rest of the block wraps. The command is in the HTML once and whole. `PacketBlock` in `apps/web/components/v2/screens/fix/PacketChoice.tsx`; the rules are `.exact` and `.exactLine` in `FixScreen.module.css`.',
    '',
    `A prompt’s first line is \`${PROMPT_TITLE_LABEL} "…"\`: the fix’s title on one line in straight double quotes, with each quotation mark in it (\`" “ ” „ ‟ « »\`) written as an apostrophe and backslashes at its end dropped (\`promptTitle\`).`,
    '',
    'Verify: `pnpm --filter @crawlmouse/web exec vitest run lib/v2/view/fix.test.ts lib/v2/view/segment/fixes.test.ts lib/v2/view/segment/fixes.property.test.ts __tests__/v2/fix.test.tsx __tests__/v2/explorer.dom.test.tsx __tests__/v2/fix-words.test.tsx`. The last of these also scans the fix page’s own text, on each live fix of the bad, built and challenged fixtures, for a count of one before a plural and for a word shaped like an enum value or key (owner rulings 2 and 3); it leaves the packet’s strings, which are the engine’s, to the engine’s tests.',
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
    `From \`tests/visual/budgets.ts\`, which \`tests/visual/perf.spec.ts\` reads. CI runs it on \`next start\` after \`next build\` (VISUAL_SERVER=start, VISUAL_PERF=1, one worker). Each window is measured ${RUNS} times and each budget is judged on the median of its ${RUNS} readings (\`docs/ops/ci-timing.md\`).`,
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

/** What this spec leaves undone, by decision or for a later brief; each is checked by hand. */
const KNOWN_GAPS: [string, string][] = [
  [
    'The Orphans filter opens unpressed',
    'The lock opens it pressed; the hubs view draws no orphan, so pressing it would dim every page.',
  ],
  [
    'The phone map is not centred on load',
    'It scrolls the selected page into view instead, on load and on each selection.',
  ],
  [
    'Zoom out and Fit load disabled',
    'The lock draws them enabled; at the whole map neither does anything, so they are disabled until the reader zooms in.',
  ],
  [
    'An empty shell is a bad pill',
    'The lock’s “12% text without JS” is a warn pill; this follows the Readable without JavaScript page’s states, where an empty shell is bad.',
  ],
  [
    'A kept Free audit’s Pro wall has no ask',
    'With no keep bar there is nothing on the page to open; the plan page it would link to is not built yet.',
  ],
  [
    'A kept audit’s fix page has no email ask and no mark-done card',
    'Both are account actions, which the previews do not have; an audit nobody has kept asks for them through the keep bar.',
  ],
  [
    'Preview links to “#”',
    'A fix with no preview page (the next fix after the challenged and locked previews), and the resolved preview’s crumbs and tabs, whose site has no segment previews.',
  ],
  [
    'No front end on a measured check',
    'The engine records the CMS and the edge vendor and leaves `stack.frontend` null (`packages/engine/src/v2/build/record.ts`), so on a measured check “your stack as detected” can be said of a WordPress or a Webflow body (`FRAMEWORK_OF_CMS` in `packages/engine/src/v2/packets/stack.ts`).',
  ],
  [
    'Not linked: a page’s own orphans',
    'The lock lists the orphans a page should link to; the contract relates no orphan to a page beside its suggested parent.',
  ],
  [
    'The switch in the previews',
    'A fix preview shows the switch card when its fixture’s packet holds more than one body; “The framework switch” counts how many do. The switch is also rendered from a hand-made packet in `apps/web/__tests__/v2/explorer.dom.test.tsx`.',
  ],
  [
    'A segment’s open fix shows one body',
    'The packet’s own. The other bodies are on the fix page.',
  ],
  [
    'The 2,000-node page’s weight',
    'Its server-rendered list and props are not budgeted, and the budget window starts after hydration.',
  ],
  [
    'Forced colours on the new pages',
    'Pressed toggles have forced-colours rules; no Playwright case renders them.',
  ],
  [
    'Search engines grouped by verdict',
    'Each row takes its first engine’s evidence and qualifier; in the fixtures every engine in a row has the same.',
  ],
  [
    'A second copy of the generated graph',
    'The engine’s layout test keeps its own `generatedGraph` (packages/engine is out of this brief’s scope).',
  ],
];

function gapsSection(): string {
  return ['## Known gaps', '', table(['Gap', 'Why'], KNOWN_GAPS)].join('\n');
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
    linkSection(),
    '',
    freeSection(),
    '',
    frameworkSection(),
    '',
    verifyLayersSection(),
    '',
    noPacketSection(),
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
    gapsSection(),
    '',
  ].join('\n');
  const options = (await resolveConfig(SPEC_24_PATH)) ?? {};
  return format(md, { ...options, parser: 'markdown' });
}
