/**
 * Renders docs/specs/v2/30-fix-packets.md.
 *
 * Read from the code and the two fixtures when the document is rendered, by iterating them: the
 * registry, the stack bodies and their documentation, the bounds, the thresholds, the crawler table,
 * the effort and before/after rules, the detector's state table, the cause and check sentences, the
 * structure reader's lists, the CMS signals and the example packets.
 *
 * Written here and checked by review: the decisions (`DECISIONS`), the per-type notes (`NOTES`), the
 * open limits (`OPEN_LIMITS`), the false-positive notes (`SIGNAL_NOTES`), the review record, the
 * mutations and the comparison (`VOICE`). A file one of them names is looked up when the document is
 * rendered (`file`), and so is a test title (`held`): a missing one throws. spec.test.ts fails when
 * the file differs from this render.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import {
  AccessCauseSchema,
  ContentCheckSchema,
  PacketFrameworkSchema,
  type AccessCause,
  type ContentCheck,
  type FixType,
  type PageResult,
} from '@crawlmouse/types/v2';
import { gradeSources } from '../../../fixtures/v2/grade/guard.js';
import { SIGNATURES } from '../../cms-detection/index.js';
import type { AccessDetection } from '../access/types.js';
import { DETECTORS_RUN } from '../build/diff.js';
import type { ContentDetection } from '../content/aggregate.js';
import { CONTENT_CHECKS } from '../content/checks.js';
import * as T from '../content/thresholds.js';
import { AWAITING_FIX_STATUSES } from '../build/plan.js';
import { CRAWLER_REGISTRY_V2 } from '../crawler-registry.js';
import { firstPageOf } from '../detectors/duplicate-pagination.js';
import {
  detectRendered,
  RENDERED_INDETERMINATE_REASONS,
  SHELL_KEY_PREFIX,
  type RenderedDetection,
  type RenderedIndeterminateReason,
  type RenderedInputPage,
} from '../detectors/rendered.js';
import { code, table } from '../detectors/spec.js';
import { MAX_HEALTHY_DEPTH, SIMHASH_HAMMING_K, TOP_HUB_FRACTION } from '../detectors/thresholds.js';
import { FIX_SECTION } from '../diff/subjects.js';
import { SERVER_RENDERED_SHARE } from '../grade/effects.js';
import { MAX_TITLE_CHARS, RENDERED_CLASS, renderedConfidence, titleOf } from '../grade/outcomes.js';
import { COUNTERFACTUALS } from '../grade/spec.js';
import { PAGES_PER_FIX_TEMPLATE } from '../render/sample.js';
import { EMPTY_SHELL_BELOW, EMPTY_SHELL_LEAVES_ABOVE, READABLE_FROM } from '../render/state.js';
import { BEFORE_AFTER_RULES } from './before-after.js';
import {
  PAGES_SHOWN as RENDERED_PAGES_SHOWN,
  SKIPPED,
} from './by-type/client-rendered-template.js';
import {
  EDGE_VENDOR_SOURCES,
  MITIGATION,
  PAGES_SHOWN as EDGE_PAGES_SHOWN,
} from './by-type/edge-rule-blocks-crawler.js';
import { missingAuthorDateSources } from './by-type/missing-author-date.js';
import {
  missingSchemaDescriptionSources,
  PAGE_TYPES_NAMED,
} from './by-type/missing-schema-description.js';
import { QUESTION_MARKS } from './by-type/no-question-headings.js';
import { PACKET_BOUNDS } from './compose.js';
import {
  CHROME_GAP,
  contentContext,
  EXAMPLE_PAGES,
  RECHECK,
  TEMPLATE_CHARS,
  URL_CHARS,
} from './content-rule.js';
import { userAgentOf } from './crawler.js';
import { EFFORT_RULES } from './effort.js';
import {
  canonicalIs,
  CAP,
  command,
  COMMAND_BOUNDS,
  fetchOf,
  holds,
  linksTo,
  MAX_ATTRS,
  MAX_PARAMS,
  PAGE_END,
  sameInCommand,
} from './html-checks.js';
import { PACKETS } from './registry.js';
import { commandOf, crawledWord, url as shellUrl } from './shell.js';
import { FRAMEWORK_OF_CMS } from './stack.js';
import { CRAWLABLE_LINK, GOOGLE_DOCS, TAGS, UNREAD_HREF } from './structure.js';
import { clean, code as crawledCode, MAX_CRAWLED_CHARS, textOf } from './text.js';
import type { DocSource, PacketFacts } from './types.js';

const ROOT = new URL('../../../../../', import.meta.url);
/** The directory a path in this file is under unless it starts at the repository root. */
const V2 = 'packages/engine/src/v2/';

export const SPEC_URL = new URL('docs/specs/v2/30-fix-packets.md', ROOT);
const LAB_FIXTURE = 'packages/engine/fixtures/v2/build/expected.json';
const HAND_FIXTURE = 'apps/web/lib/fixtures/v2/bad-site.json';

const FIX_TYPES = Object.keys(PACKETS) as FixType[];
const STACKS = PacketFrameworkSchema.options.filter((f) => f !== 'generic');

const fullPath = (path: string): string =>
  /^(apps|docs|packages|tests)\//.test(path) ? path : `${V2}${path}`;

/** A path as the document shows it; throws when the repository holds no such file. */
function file(path: string): string {
  if (!existsSync(new URL(fullPath(path), ROOT))) {
    throw new Error(`packets spec: ${fullPath(path)} does not exist`);
  }
  return code(path);
}
const files = (paths: readonly string[]): string => paths.map(file).join(', ');

const sourceOf = (path: string): string => readFileSync(new URL(fullPath(path), ROOT), 'utf8');

/** A test, as its file and its title; throws when the file does not hold the title. */
function held(path: string, title: string): string {
  if (!sourceOf(path).includes(title)) {
    throw new Error(`packets spec: ${path} holds no test titled “${title}”`);
  }
  return `${file(path)} “${title}”`;
}

/** Text in a code span, whatever backticks it holds. */
function span(text: string): string {
  if (!text.includes('`')) return code(text);
  return `\`\` ${text} \`\``;
}

/** A fenced block, with a fence longer than any run of backticks in it. */
function fenced(lines: readonly string[], lang = 'text'): string {
  const text = lines.join('\n');
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${lang}\n${text}\n${fence}`;
}

const bullets = (items: readonly string[]): string => items.map((i) => `- ${i}`).join('\n');
const or = (text: string, none: string): string => (text === '' ? none : text);
const codes = (items: readonly string[]): string => items.map(code).join(', ');
const json = (value: unknown): string => JSON.stringify(value);

// --- the two fixtures ------------------------------------------------------------------------------

interface See {
  command: string;
  today: string;
  after: string;
}
interface Body {
  framework: string;
  context: string[];
  change: string[];
  keep: string[];
  verify: { command: string; expect: string; ua: string | null; see: See | null };
}
interface Packet extends Body {
  frameworks: string[];
  packets: Body[];
}
interface FixtureFix {
  type: FixType;
  title: string;
  effort: unknown;
  before_after: unknown[];
  packet: Packet | null;
}
type Written = FixtureFix & { packet: Packet };

interface Fixture {
  fixes: FixtureFix[];
  check?: { stack: unknown };
  summaries?: Record<string, unknown>[];
}

const fixtureOf = (path: string): Fixture => JSON.parse(sourceOf(path)) as Fixture;

const writtenIn = (fixes: readonly FixtureFix[]): Written[] =>
  fixes.flatMap((f) => (f.packet === null ? [] : [{ ...f, packet: f.packet }]));

/** The first fix of each type that carries a packet, in the fixture's order. */
function firstPackets(fixes: readonly FixtureFix[]): Map<FixType, Written> {
  const out = new Map<FixType, Written>();
  for (const f of writtenIn(fixes)) if (!out.has(f.type)) out.set(f.type, f);
  return out;
}

/** One fix of the lab fixture as the engine wrote it: each stored string on a line of its own. */
function packetBlock(fix: Written): string {
  const p = fix.packet;
  const section = (name: string, lines: readonly string[]) => [
    `${name}:`,
    ...lines.map((l) => `  ${l}`),
  ];
  const see = p.verify.see;
  return fenced([
    `title: ${fix.title}`,
    `frameworks: ${p.frameworks.join(', ')}`,
    `effort: ${fix.effort === null ? 'none' : json(fix.effort)}`,
    `before_after: ${fix.before_after.length === 0 ? 'none' : fix.before_after.map(json).join(' ')}`,
    ...section('context', p.context),
    ...section(`change (${p.framework})`, p.change),
    ...section(`keep (${p.framework})`, p.keep),
    ...(see === null
      ? ['See it: none']
      : section('See it', [see.command, `today: ${see.today}`, `after: ${see.after}`])),
    ...section(`Exact check (ua: ${p.verify.ua ?? 'none'})`, [
      p.verify.command,
      `expect: ${p.verify.expect}`,
    ]),
    ...p.packets.flatMap((b) => [
      ...section(`change (${b.framework})`, b.change),
      ...(json(b.keep) === json(p.keep)
        ? [`keep (${b.framework}): as ${p.framework}`]
        : section(`keep (${b.framework})`, b.keep)),
    ]),
  ]);
}

// --- §2: the decisions -----------------------------------------------------------------------------

interface Decision {
  id: string;
  decision: string;
  built: string;
  where: readonly string[];
  tests: readonly string[];
}

const DECISIONS: readonly Decision[] = [
  {
    id: 'D1',
    decision:
      'One builder per fix type behind one registry; a type with no entry does not compile.',
    built:
      '`PACKETS` is a mapped type over `FixType`: an entry is a builder or a `NoPacket` with its reason (§3). `draft` (grade/outcomes.ts) calls the `WriteFix` it is handed, which `writtenFrom` builds over the registry. The same record and facts give the same packet, compared as JSON by a property test.',
    where: ['packets/registry.ts', 'packets/types.ts', 'packets/written.ts', 'grade/outcomes.ts'],
    tests: [
      'packets/registry.test.ts',
      'packets/compose.test.ts',
      'packets/test-support/content.ts',
      'build/build.test.ts',
    ],
  },
  {
    id: 'D2',
    decision: 'A sentence that names measured data is rendered from the record.',
    built:
      'A packet line is made by the tagged template `line`, whose values are made by `code`, `count`, `ours` or `list`; a plain string does not type-check and a value made elsewhere throws. A sampled finding states its sample in the context (§5).',
    where: ['packets/text.ts', 'packets/structure.ts', 'packets/content-rule.ts'],
    tests: [
      'packets/text.test.ts',
      'packets/edge-rule-blocks-crawler.test.ts',
      'packets/client-rendered-template.test.ts',
      'packets/content-rule.test.ts',
    ],
  },
  {
    id: 'D3',
    decision: 'The verify block is a command that can fail.',
    built:
      'A packet carries a readable command and a strict one (§4): “See it” prints the evidence, “Exact check” exits 0 once the fix has landed. The exact check of each type is run with `sh -c` against a local server in a broken and a fixed state. The cases where an exact check can pass before the fix are listed per type in §5 under the open limits; they await a fix or an owner exception.',
    where: [
      'packets/shell.ts',
      'packets/html-checks.ts',
      'packets/content-rule.ts',
      'packets/test-support/verify.ts',
    ],
    tests: [
      'packets/test-support/verify.test.ts',
      'packets/html-checks.test.ts',
      'packets/content-fixture.test.ts',
      'packets/live-proof.test.ts',
    ],
  },
  {
    id: 'D4',
    decision:
      'A stack body where the platform’s documentation supports its steps; `frameworks` lists bodies that exist.',
    built:
      'A stack body carries `sources` (title, URL, read date, what it supports), rendered in §5. `compose` computes `frameworks` from the bodies written.',
    where: ['packets/compose.ts', 'packets/types.ts'],
    tests: ['packets/compose.test.ts', 'packets/registry.test.ts'],
  },
  {
    id: 'D5',
    decision: 'The front end is detected.',
    built:
      'Narrowed (Q2). The worker records a CMS name and no marker, so `stack.frontend` stays null. The first body is chosen by `frameworkOf`: the detected front end when a later step records one, else the framework the CMS is (§8).',
    where: ['packets/stack.ts', 'build/record.ts'],
    tests: ['packets/stack.test.ts', 'packets/compose.test.ts'],
  },
  {
    id: 'D6',
    decision: 'The two rendered-page fix types open.',
    built:
      'Narrowed. `client_rendered_template` opens, from the render step’s own `state` per page (§6). `js_only_navigation` is not opened: the render step keeps no link (Q3). A route that serves an empty root is classed thin and is not rendered, so it gets no record (Q5).',
    where: ['detectors/rendered.ts', 'grade/effects.ts', 'grade/outcomes.ts', 'build/diff.ts'],
    tests: [
      'detectors/rendered.test.ts',
      'detectors/rendered-build.test.ts',
      'grade/effects.rendered.test.ts',
      'build/client-rendered.test.ts',
    ],
  },
  {
    id: 'D7',
    decision: 'Before/after and effort from what was measured.',
    built:
      'A rule per fix type for both, as data (§7). `after` comes from `servedAll`, `allPassing` and `SERVER_RENDERED_SHARE` of grade/effects.ts. Narrowed: no rule states `minutes`, because no record holds a measure of time; those fixes carry no effort.',
    where: ['packets/effort.ts', 'packets/before-after.ts', 'grade/effects.ts'],
    tests: [
      'packets/effort.test.ts',
      'packets/before-after.test.ts',
      'packets/before-after.same-code.test.ts',
    ],
  },
  {
    id: 'D8',
    decision: 'Crawled text inside a packet is hostile.',
    built:
      'Crawled text enters a line through `code` and a command through `url` or `crawledWord` (§3). Lines, sections and a packet of several bodies are bounded, and a bound that withholds says so. The fix title is cleaned and bounded by `titleOf` (Q7). The cleaning function is in clean-text.ts (Q9).',
    where: [
      'clean-text.ts',
      'packets/text.ts',
      'packets/shell.ts',
      'packets/compose.ts',
      'grade/outcomes.ts',
    ],
    tests: [
      'packets/text.test.ts',
      'packets/shell.test.ts',
      'packets/compose.test.ts',
      'packets/html-checks.test.ts',
      'apps/web/lib/v2/view/segment/fixes.property.test.ts',
    ],
  },
  {
    id: 'D9',
    decision: 'The web side shows what now exists.',
    built:
      'The switch offers the bodies a packet holds; the packet route serves the chosen body; the fix page, the prompt and the download show “See it” above “Exact check”; a fix with no packet says the registry’s reason, or that its last check wrote no steps. Web files beyond the brief’s list were edited (Q6, Q9). Written up in `docs/specs/v2/24-fix-and-map.md`.',
    where: [
      'apps/web/lib/v2/view/fix.ts',
      'apps/web/lib/v2/account/fixes.ts',
      'apps/web/lib/v2/view/no-packet.ts',
      'apps/web/lib/v2/view/packet-reason.ts',
      'apps/web/lib/v2/view/segment/fixes.ts',
      'pipeline-surface.ts',
    ],
    tests: [
      'apps/web/lib/v2/view/fix.test.ts',
      'apps/web/app/api/fixes/[id]/packet/route.test.ts',
      'apps/web/lib/v2/view/packet-reason.test.ts',
      'apps/web/lib/v2/view/segment/fixes.test.ts',
      'apps/web/__tests__/v2/fix.test.tsx',
    ],
  },
  {
    id: 'D10',
    decision: 'Voice: a senior engineer’s ticket; the fixtures’ packets are the reference.',
    built:
      'The engine’s packets for the lab fixture are compared with the hand-written ones in §9.',
    where: ['packets/spec.ts', HAND_FIXTURE, LAB_FIXTURE],
    tests: ['packets/spec.test.ts'],
  },
  {
    id: 'D11',
    decision:
      'Out of this step: model-written text, further fix types, competitor data, sending the email, the unmark lifecycle.',
    built: 'Nothing.',
    where: [],
    tests: [],
  },
];

// --- §3: bounds and the text rules -----------------------------------------------------------------

/** What each bound bounds, by its key. A key with no note here is still rendered, and says so. */
const BOUND_MEANING: Readonly<Record<string, string>> = {
  line_chars:
    'Code points in one line of a section, in `expect`, and in the readable layer’s `today` and `after`. A longer line is cut and says how long it was; a code span the cut left open is closed.',
  section_lines:
    'Lines in a section. A longer section keeps its first lines up to the bound, and a last line counts the rest.',
  packet_chars:
    'Characters, as JSON, of a packet that holds more than one body. Past it the packet keeps the body for its own framework, and its context says how many rewrites were left out.',
  one_body_chars:
    'Not enforced by `compose`: a packet of one body is returned whatever its size. compose.test.ts builds the structure packets from URLs of the worker’s longest and from its largest records, and holds each under this number.',
  url_chars:
    'The longest URL a structure command names: the worker’s `MAX_URL_LENGTH`. A declared canonical longer than this is not treated as a URL (`httpUrl`).',
  listed_chars:
    'Characters of shell words in a list a command could do without (`listed`). The list stops there, and `expect` says how many it left out.',
};

function boundLines(name: string, bounds: Readonly<Record<string, number>>): string[] {
  return Object.entries(bounds).map(
    ([key, value]) =>
      `${code(`${name}.${key}`)} = ${value}. ${BOUND_MEANING[key] ?? 'No note is written for this key in spec.ts.'}`,
  );
}

const TEXT_RULES: readonly [string, string, string][] = [
  [
    '`clean` (clean-text.ts)',
    'crawled text',
    'Removes format, private-use, surrogate, unassigned and variation-selector code points, and a listed set of letters and marks that render blank; turns a run of control characters, line separators and spaces into one space; turns a backtick into an apostrophe; trims.',
  ],
  [
    '`code`',
    'crawled text, a bound',
    '`clean`, then a cut at the bound in code points that says how long the text was, then a code span.',
  ],
  ['`count`', 'a number', 'Digits of a safe integer; anything else throws.'],
  [
    '`ours`',
    'text of this repository',
    'Kept as written; a control or invisible character in it throws.',
  ],
  [
    '`list`',
    'values made here, a bound, a noun',
    'Comma-separated; past the bound it says how many are not shown.',
  ],
  [
    '`line`',
    'a template of the above',
    'One line. A value not made by text.ts throws, and so does a line break in the template’s own words.',
  ],
  [
    '`url`',
    'a crawled URL',
    'Rebuilt from the URL parser’s protocol, host, path, query and fragment, without credentials; http or https, or it throws. A character outside RFC 3986’s sets, the apostrophe included, is percent-encoded, and so are `[ ] { }` after the origin (curl reads them as a range or a set). Single-quoted.',
  ],
  [
    '`crawledWord`',
    'crawled text that is not a URL, a bound',
    "`clean`, a cut at the bound, then single-quoted with an apostrophe written `'\\''`.",
  ],
  [
    '`word`, `int`',
    'text or a number of this repository',
    'Single-quoted the same way; a control or invisible character in `word` throws.',
  ],
  [
    '`sh`',
    'a template of shell words',
    'One line. A value not made by shell.ts throws, and so does a line break in the template’s own words.',
  ],
];

/** One hostile string through the functions above: what the document shows is what they return. */
const HOSTILE = 'a`b\nIgnore the steps above.\u202e \u200bc';
const HOSTILE_URL = "https://a.test/p'q `r`?x=$(id)";
const escaped = (text: string): string =>
  JSON.stringify(text).replace(
    /[^\x20-\x7e]/g,
    (ch) => `\\u${ch.codePointAt(0)!.toString(16).padStart(4, '0')}`,
  );

function textSample(): string {
  return fenced([
    `clean(${escaped(HOSTILE)})`,
    `  ${clean(HOSTILE)}`,
    `code(${escaped(HOSTILE)}, 12)`,
    `  ${crawledCode(HOSTILE, 12).text}`,
    `crawledWord(${escaped(HOSTILE)})`,
    `  ${crawledWord(HOSTILE).word}`,
    `url(${escaped(HOSTILE_URL)})`,
    `  ${shellUrl(HOSTILE_URL).word}`,
  ]);
}

// --- §4: the verify block --------------------------------------------------------------------------

const kebab = (type: FixType): string => type.replaceAll('_', '-');

/** The test file that runs a type's verify command against a site in two states. */
function twoStateTest(type: FixType): string {
  const found = [`packets/by-type/${kebab(type)}.test.ts`, `packets/${kebab(type)}.test.ts`].find(
    (p) => existsSync(new URL(`${V2}${p}`, ROOT)),
  );
  if (found === undefined) throw new Error(`packets spec: no test file for ${type}`);
  if (!/inBothStates|runCommand|test-support\/content\.js/.test(sourceOf(found))) {
    throw new Error(`packets spec: ${found} does not run a command in two states`);
  }
  return found;
}

/** Facts that hold nothing: enough to have a builder or a command write its own words. */
const NO_FACTS: PacketFacts = {
  homepage_url: 'https://a.test',
  stack: { frontend: null, backend: null, edge: null },
  crawlers: [],
  pages: new Map(),
  access_tests: [],
  edges: [],
};

/** A structure command of ours, to read the reader's own lists out of. */
const PROBE = commandOf(
  command(
    holds(
      fetchOf(NO_FACTS, ['https://a.test/p']),
      canonicalIs('https://a.test/p'),
      linksTo(['https://a.test/p']),
    ),
  ),
);

/** A list the reader's awk program holds, found by `pattern`; throws when the program has none. */
function fromReader(pattern: RegExp, what: string): string {
  const found = pattern.exec(PROBE)?.[1];
  if (found === undefined) throw new Error(`packets spec: the reader holds no ${what}`);
  return found;
}

const READER = {
  /** Elements whose bodies `scan` does not read. */
  unread: fromReader(/\^\((script[a-z|]+)\)/, 'list of unread elements').split('|'),
  /** The tags the head may hold before `hd` ends it. */
  head: fromReader(/\^<\\\/\?\(([a-z|]+)\)/, 'list of head elements').split('|'),
  /** The named character references `ent` reads. */
  named: fromReader(/e = " ((?:[A-Za-z]+=[0-9]+ )+)"/, 'list of named references')
    .trim()
    .split(' ')
    .map((pair) => `&${pair.split('=')[0]};`),
  /** The percent-escapes `dec` leaves escaped. */
  kept: fromReader(/h ~ \/\^\(([0-9A-F|]+)\)\$\//, 'list of kept escapes').split('|'),
};

const escapeShown = (hex: string): string => {
  const point = parseInt(hex, 16);
  return point === 0 ? '`%00` (NUL)' : `${code(`%${hex}`)} (${code(String.fromCharCode(point))})`;
};

/** Pairs of URLs put to `sameInCommand`: the verdict the document shows is the function's. */
const URL_PAIRS: readonly [string, string][] = [
  ['https://a.test/p', 'https://a.test/p/'],
  ['https://a.test/caf\u00e9', 'https://a.test/caf%C3%A9'],
  ['https://a.test/l?b=2&a=1', 'https://a.test/l?a=1&b=2'],
  ['https://a.test/l?a', 'https://a.test/l?a='],
  ['https://a.test/x~y', 'https://a.test/x%7Ey'],
  ['https://a.test/a/b', 'https://a.test/a%2Fb'],
  ['https://a.test/a?b', 'https://a.test/a%3Fb'],
  ['https://a.test/p', 'https://www.a.test/p'],
];

/** The sentence a cause is said in: the edge builder's own context line for a record that names it. */
function causeSentence(cause: AccessCause): string {
  const entry = PACKETS.edge_rule_blocks_crawler;
  if (entry.kind !== 'builder') throw new Error('packets spec: the edge type has no builder');
  const record: AccessDetection = {
    type: 'edge_rule_blocks_crawler',
    fingerprint: '0'.repeat(16),
    key: 'edge:gptbot',
    crawler: 'GPTBot',
    group: 'ai_training',
    scored: false,
    state: 'detected',
    reason: null,
    measured: 1,
    extent: { matching: 1, of: 1 },
    recommendation_class: 'best_practice',
    confidence: 'likely',
    intent: null,
    opens_fix: true,
    affected_urls: ['https://a.test/p'],
    evidence: { access_test_ids: [], pages: [], causes: [cause], signatures: [] },
  };
  const lines = entry.context(record, NO_FACTS).map(textOf);
  const said = lines.map((l) => /^Cause the responses name: (.*)\.$/.exec(l)?.[1]).find(Boolean);
  if (said === undefined) throw new Error(`packets spec: no sentence for the cause ${cause}`);
  return said;
}

/** What a content check looks for, in the words of the first line of a content packet's context. */
function checkWords(check: ContentCheck): string {
  const fix: ContentDetection = {
    type: 'quotable_opening',
    check,
    fingerprint: '0'.repeat(16),
    key: 'x:/t/{slug}',
    template_key: '/t/{slug}',
    state: 'detected',
    reason: null,
    measured: 1,
    extent: { failing: 1, of: 1, unread: 0 },
    recommendation_class: 'best_practice',
    affected_urls: ['https://a.test/t/a'],
  };
  const [first] = contentContext(fix, NO_FACTS, []).map(textOf);
  const said = /^The check for (.*) fails on /.exec(first ?? '')?.[1];
  if (said === undefined) throw new Error(`packets spec: no words for the check ${check}`);
  return said;
}

// --- §5: per fix type ------------------------------------------------------------------------------

interface TypeNotes {
  /** What the packet says, and from which fields. Empty for a type with no packet. */
  rule: string;
  /** What the exact check tests. */
  verify: string;
  /** What the readable command prints. */
  see: string;
  /** Limits the packet's own text states, with where. */
  stated: readonly string[];
  /** What the packet does not say, because the audit did not measure it. */
  unsaid: readonly string[];
}

const pct = (share: number): string => `${Math.round(share * 100)}%`;
/** What the five content packets' contexts share; said once, above the types. */
const CONTENT_SHARED = `The content packets (${codes(Object.values(CONTENT_CHECKS).flatMap((c) => (c.fix ? [c.fix] : [])))}) open with the same context (\`contentContext\`): the check in words, the failing pages of the pages decided, the rule, the pages not read when there are any, the first ${EXAMPLE_PAGES} failing pages at the address each is served at (a URL is cut at ${URL_CHARS} code points, a template key at ${TEMPLATE_CHARS}) with the rest counted, and whether the check counts in a grade. Under a content type, “Rule” gives the rule its context states.`;
const CONTENT_SEE = 'One match of a pattern of ours per line (`seeMarkup`, §4).';
const NO_PAGE_TEXT = 'What a failing page says: the audit keeps no page text.';
const CHROME_STATED = '`CHROME_GAP` (§4), in `expect`.';
const RECHECK_STATED = '`RECHECK` (§4), in `expect`.';
const UNREAD_STATED = '`UNREAD_HREF` (§4), in `expect`.';
const NONE_NOTES: TypeNotes = { rule: '', verify: '', see: '', stated: [], unsaid: [] };

const NOTES: { readonly [K in FixType]: TypeNotes } = {
  robots_txt_blocks_crawler: NONE_NOTES,
  edge_rule_blocks_crawler: {
    rule: `Context, from the access record and the worker rows it names (\`evidence.access_test_ids\`): the crawler; the pages refused of the sampled pages it was judged on (\`extent\`); a tally of the rows’ \`raw_status\`; the causes the record names, each in words (§4), or a line saying the responses name no product; the response headers recorded (\`evidence.signatures\`); the identities served on the same pages (\`witness.ua\`); that the audit’s request carried a Crawlmouse tag, when the rows say so; the pages refused, ${EDGE_PAGES_SHOWN} shown and the rest counted. Change: the first step asks whether the crawler should be let in and gives the registry’s \`purpose\` for it. The steps that follow name no product unless \`facts.stack.edge.vendor\` is \`Cloudflare\`. Then: for a record whose causes include \`cloudflare_1020\`, the steps Cloudflare’s page for that error supports; for another record, the places in the dashboard to look, with the pages below.`,
    verify: `Requests the first affected page (sorted), at the address its content was read at, with the blocked crawler’s user agent, and writes the response headers to an awk program. Exits 0 when the last status line says 200 and no challenge header follows it. The challenge headers are the worker’s (\`MITIGATION\`): ${MITIGATION.map(([header, value]) => `${code(header)} holding ${code(value)}`).join(', ')}. The builder throws for a crawler the registry cannot request as, and for a record with no affected page.`,
    see: 'The same request, printing the status alone. `today` is the status of the audit’s own request for that page when its row holds one; `after` is `200`.',
    stated: [
      'A redirect is not followed and does not pass (`expect`).',
      'The command reads the status and the challenge headers, not the body: a block page served with status 200 and none of those headers passes (`expect`).',
      'The audit’s request was tagged and came from Crawlmouse’s address; what the operator’s own crawler gets is in the site’s logs (context, when the rows are tagged).',
    ],
    unsaid: [
      'Which product holds the rule, unless the check recorded Cloudflare.',
      'What the operator’s own crawler is served.',
      'Whether the owner wants the crawler let in.',
    ],
  },
  client_rendered_template: {
    rule: `Context, from the record: the template key; the pages rendered of the pages graded; for the first ${RENDERED_PAGES_SHOWN} rendered pages (by URL), the words in the HTML response and the words once rendered, the rest counted; the median share; the sample (“Measured by rendering N pages. The other M graded pages of the template were not rendered”); the scope (the audit renders pages it grades, so another template can have the fault unmeasured); and a last line when no tested crawler is served. The generic change: find what adds the content, render it on the server or at build time, deploy. The packet names no mechanism: the record holds word counts.`,
    verify: `Requests the record’s first rendered page (by URL), at the address its content was read at, and counts the words of the HTML response outside ${codes(SKIPPED)} elements and outside comments. It prints the count and exits 0 when the count reaches \`wordsNeeded\`: ${pct(READABLE_FROM)} (\`READABLE_FROM\`) of that page’s rendered words, rounded up.`,
    see: 'The same response with its tags removed (`sed`), counted by `wc -w`. `today` and `after` give the audit’s two counts for the page and say the rough count is usually higher.',
    stated: [
      'An error status does not pass (`expect`).',
      'The count differs a little from the audit’s, and a page with that much text outside its main content passes unfixed (`expect`).',
      `The audit’s next check closes the fix sooner than the command passes: once each rendered page has more than ${pct(EMPTY_SHELL_LEAVES_ABOVE)} (\`EMPTY_SHELL_LEAVES_ABOVE\`) of its rendered words in the HTML response (\`expect\`).`,
    ],
    unsaid: [
      'What adds the words in the browser: the front end is not detected (Q2).',
      'The words of the pages that were not rendered.',
      'Which crawlers run JavaScript.',
    ],
  },
  orphan_pages: {
    rule: 'Context: how many other crawled pages answered 200, none of which links to the page. Change: one link on `suggested_parent_url`, with how the audit ranks its suggestion and how many clicks that parent is from the homepage (`depthLine`: whether the link also settles the depth); with no suggested parent the step says so and names no page. The page’s title is offered as a starting point for the link text when the crawl read one.',
    verify:
      'Requests the suggested parent, or the homepage when there is none, and passes when one of its `<a>` elements links to the orphan: its URL, or an address the crawl files under it (`addressesOf`).',
    see: 'The `<a>` tags of that page that hold the orphan’s path. `today`: nothing. `after`: the tag that was added.',
    stated: [
      'With no suggested parent the command requests the homepage, and the reader is told to put the page they linked from in its place (`expect`).',
      'A link that spells the path another way is not printed by the readable command; the exact check reads it (`after`).',
    ],
    unsaid: [
      'That no link exists anywhere: the claim is about crawled pages that answered 200.',
      'Why the audit suggests no parent, when it suggests none.',
    ],
  },
  quotable_opening: {
    rule: `The check applies to a page of prose (an H1 with at least ${T.MIN_BODY_WORDS} words after it and no \`Product\` JSON-LD) and passes when, in the first ${T.OPENING_WORDS} words after the H1, a block other than a list item with at least ${T.MIN_BLOCK_WORDS} words holds a sentence of ${T.ANSWER_SENTENCE_WORDS.min} to ${T.ANSWER_SENTENCE_WORDS.max} words that ends in a full stop.`,
    verify:
      'The same rule on the served HTML, tag by tag: after the first `h1`, each opening block’s text is gathered and judged until the word bound is read.',
    see: `${CONTENT_SEE} Here: the markup that follows the H1, cut to a fixed length.`,
    stated: [CHROME_STATED, RECHECK_STATED],
    unsaid: [NO_PAGE_TEXT],
  },
  generic_anchor_text: {
    rule: `Context: the hub, one of the top ${pct(TOP_HUB_FRACTION)} of crawled pages by internal PageRank (\`TOP_HUB_FRACTION\`), and the generic links of the recorded links (recorded = generic / \`measured\`, rounded). Change: one line per generic link (its text, its target, the target’s title when read) up to a bound, the rest counted.`,
    verify:
      'Requests the hub and passes when it has same-site links and the first link to each target says none of the recorded generic texts the command names. Texts are compared without case, with spaces collapsed, character references read and the tags inside a link removed (`noLinkSays`). The builder throws for a record none of whose links the check holds a text for.',
    see: 'The `<a …>text</a>` matches of the hub that hold one of the first few recorded texts. `after`: nothing.',
    stated: [
      'The crawl records one link per target, with the first link text it found (context); a later link to the same target is not read (`expect`).',
      'The command knows the recorded phrases: another stock phrase in their place passes it, and is judged on the next check (`expect`).',
      'When the texts do not fit the command’s length, how many it leaves out (`expect`).',
      'A link with a tag inside its text is not printed by the readable command (`today`).',
    ],
    unsaid: ['The anchors the crawl did not keep: a second link to the same target.'],
  },
  deep_pages: {
    rule: `Context: the clicks from the homepage (\`measured\`), or that no path of links reaches the page when it is null; the limit of ${MAX_HEALTHY_DEPTH} (\`MAX_HEALTHY_DEPTH\`); the pages on the recorded path, in URL order. Change: a link from a page at most ${MAX_HEALTHY_DEPTH - 1} clicks down. The page named (\`linkFrom\`) is the first of these that is that close on the detector’s graph and holds no link to the page in the crawl’s record: the parent the orphan fix for the same URL suggests; the page the effect estimate links from (\`shallowParent\`, grade/effects.ts); the next page that close. The change says which of them it is.`,
    verify:
      'Requests that page and passes when one of its `<a>` elements links to the deep page. When no page passes the test above (`certain` false), it requests the page the developer names in the shell variable `CRAWLMOUSE_PAGE` (`fetchOfChosen`) and exits non-zero while the variable is unset.',
    see: 'The `<a>` tags of that page that hold the deep page’s path. `today`: nothing, or, with no page to name, that the record does not say.',
    stated: [
      'If the link goes on another page, request that page instead (`expect`).',
      'The command proves the link; the click depth is measured again on the next check (`expect`).',
      'With no page the audit can vouch for, the command reads the page named in `CRAWLMOUSE_PAGE` and fails until it is set (`expect`).',
    ],
    unsaid: [
      'The depth the page will have after the fix.',
      'Whether the page named is a good editorial choice: it is chosen on the links as crawled, and the change says another page as close does as well.',
    ],
  },
  specs_as_images: {
    rule: `The check applies to a page with \`Product\` JSON-LD and fails one that shows an image of specifications (an \`<img>\` that is not a link to another page, whose alt text or file name matches \`SPEC_IMAGE\`) with no \`<table>\`, no \`<dl>\` and fewer than ${T.MIN_SPEC_LINES} “Label: value” lines with a digit in the value.`,
    verify:
      'Passes when a `<table>` or `<dl>` outside the set-aside elements holds a `<td>` or `<dd>` with text.',
    see: `${CONTENT_SEE} Here: the \`<th>\`, \`<td>\`, \`<dt>\` and \`<dd>\` cells, each with its text up to the next tag.`,
    stated: [
      'A page that gives its specifications as labelled lines without a table passes the check and not the command (`expect`).',
      CHROME_STATED,
      RECHECK_STATED,
    ],
    unsaid: ['Which image matched, on which page, and what it shows (context).', NO_PAGE_TEXT],
  },
  missing_schema_description: {
    rule: `The check passes a page when a JSON-LD node about the page itself has a \`description\` that is not empty; the context names ${codes(PAGE_TYPES_NAMED)} as examples of such a node’s type (\`PAGE_TYPES_NAMED\`); a page with no JSON-LD fails; a description on \`WebSite\` or \`Organization\`, or the meta description, does not count. The check’s type list is not exported, so the builder restates it, and its test holds it to the check’s verdict.`,
    verify:
      'Passes when one `application/ld+json` block holds both a type about the page itself (as a string, in a list, or as a schema.org IRI) and a `description` whose value starts with a character that is not a space. A script element is read as one line, so a `<` in its text does not cut the block (`AWK_SCRIPTS`).',
    see: `${CONTENT_SEE} Here: each \`"description": "…"\` pair.`,
    stated: [
      'The command does not tell which node of the block the description is on (`expect`).',
      'What the readable command prints today, if anything, is not a description on the page’s own node (`today`).',
      RECHECK_STATED,
    ],
    unsaid: [
      'What kind of page the template is: the change gives the type per kind and leaves the choice to the reader.',
      NO_PAGE_TEXT,
    ],
  },
  no_question_headings: {
    rule: `The check applies to a page of prose with at least ${T.MIN_HEADINGS} section headings (an \`h2\` or \`h3\` after the H1 whose next block is prose of at least ${T.MIN_BLOCK_WORDS} words) and passes when one \`h2\` or \`h3\` after the H1 has a clause ending in ${codes(QUESTION_MARKS)} (\`QUESTION_MARKS\`). The change asks for one heading.`,
    verify:
      'Passes when an `h2` or `h3` after the first `h1`, outside the set-aside elements, holds one of those marks followed by a space or the end of the heading.',
    see: `${CONTENT_SEE} Here: the \`<h2>\` and \`<h3>\` headings, each with its text up to the next tag.`,
    stated: [CHROME_STATED, RECHECK_STATED],
    unsaid: [NO_PAGE_TEXT],
  },
  missing_author_date: {
    rule: `The check applies to a page whose JSON-LD has an Article node and passes when the page names an author and a publication date in markup; the context lists the routes read for an author and for a date. The check’s Article type list is not exported, so the builder restates it, and its test holds it to the check’s verdict.`,
    verify:
      'Passes when the page holds an author and a date by one of those routes: `author` and `datePublished` on a JSON-LD block that holds an Article type; a `meta` element with content; `rel="author"` outside the set-aside elements; `itemprop` and `<time datetime>` outside them and inside `<body>`.',
    see: `${CONTENT_SEE} Here: each JSON-LD \`author\` or \`datePublished\` key with the characters after it, and each tag that carries a byline attribute. It is looser than the check: a tag that mentions an author in a URL is printed too.`,
    stated: [
      'The audit does not record which of the two a failing page lacks (context, `today`).',
      CHROME_STATED,
      RECHECK_STATED,
    ],
    unsaid: ['Which of author and date is missing.', NO_PAGE_TEXT],
  },
  js_only_navigation: NONE_NOTES,
  redirect_chain: {
    rule: 'Context: how many pages link to the URL; the redirects (`measured`); one line per recorded hop (from, status, Location); where the chain ends (`endOf`). At a page that answers 200 at another URL: the links are pointed at it and the redirect is kept. At the same page under the address its server serves (a trailing slash, say): the href is written as that address, or the redirect rules change. Nowhere (a loop, or a crawl that stopped on a redirect): the change is to the redirect rules.',
    verify:
      'When the chain ends at another page and the programs can tell the two URLs apart (`sameInCommand`): requests the first linking page and passes when it links to the final URL and no longer to the redirecting one. Otherwise: `curl -f -o /dev/null -L --max-redirs 1` on the address the crawl requested, which passes when it reaches a page that answers below 400 through at most one redirect.',
    see: 'In the first form: the `<a>` tags of the linking page that hold either path. In the second: the number of redirects followed and the last status (`-w`), with up to 10 redirects followed.',
    stated: [
      'The command reads the first of the linking pages: run it for each (`expect`).',
      UNREAD_STATED,
      'In the second form the command follows the redirects; links rewritten to the final address are measured on the next check (`expect`).',
    ],
    unsaid: ['Who controls the redirect rules.'],
  },
  duplicate_pagination: {
    rule: `Context: the template key and the later pages detected; then, per condition the record holds: the pages whose row declares the first page of their list as canonical (\`firstPageOf\`), with Google’s pagination page; and the near-duplicates (64-bit content hashes within ${SIMHASH_HAMMING_K} bits, \`SIMHASH_HAMMING_K\`): the detected pages that do not declare the first page, or “At least one of the pages above” when each detected page declares it. Change: a step per condition.`,
    verify:
      'On the first affected page. Canonical: the `<head>` holds one `rel="canonical"`, naming the page’s own address. Content: requests the first page and the later page in one `curl`, and passes when each links to two pages of the site the other does not link to, leaving out the first page itself and targets that hold the list’s own mark (`listMark`, `listsDiffer`). When the first affected page carries both, one program asks both.',
    see: 'Canonical: the page’s canonical tag. Content alone: the `<a>` tags that are on one of the two pages and not on the other (`sort | uniq -u`).',
    stated: [
      'The command compares links, not the content hash the audit measures, which the next check measures again (`expect`).',
      'A canonical sent in an HTTP Link header is not read (`expect`).',
      'The command reads the first of the later pages; the others are measured again on the next check (`expect`).',
    ],
    unsaid: [
      'Which page is the near-duplicate, when each affected page also declares the first page.',
    ],
  },
  canonical_mismatch: {
    rule: 'Context: the canonical the page declares; one sentence per condition the record holds, from the rows it names; and, when no fault of the target is proven and the canonical is not taken to stand, why not. The canonical the packet asks for (`read`, `expectedOf`) comes from rows: the page’s own URL when the target is on another host, gone or disallowed; where the target landed, or the canonical the target declares, when the check holds that page answering 200 at itself and declaring itself or none; otherwise the page’s own URL. With no fault of the target, the canonical stands when the check holds the target answering 200 at itself, and the links move to it. For a target on another host the first step asks whether the canonical is deliberate.',
    verify:
      'Passes when the `<head>` of the page holds one `<link rel="canonical">`, naming the expected URL, and, when links move and the programs can tell the two URLs apart (`sameInCommand`), the first linking page links to the canonical and no longer to the page; both are asked by one program. A record of links alone checks the links. Where the declared and the expected URL, or the stale and the kept one, are one URL to the programs (`sameInCommand`), the href is compared as written (`canonicalIs` in its `spelled` mode, `linksSpelled`).',
    see: 'The page’s canonical tag; for a record of links alone, the `<a>` tags of the linking page that hold either path.',
    stated: [
      'If another live URL is the one meant to be indexed, name that one; the command checks for the URL the packet offers (change).',
      'A link left to open the URL as a variant keeps the command non-zero (change).',
      'A canonical sent in an HTTP Link header is not read (`expect`).',
      'The command reads the first linking page: run it for each (`expect`).',
      UNREAD_STATED,
      'When the command cannot tell a link to the one URL from a link to the other, the links are measured on the next check (`expect`).',
    ],
    unsaid: [
      'Which URL the site means to have indexed.',
      'Why the canonical is wrong, and which file or setting writes it.',
    ],
  },
  hreflang_gap: {
    rule: 'Context: the cluster’s key, its crawled members and the members marked; one sentence per condition the record holds, saying “It” with one marked page and “At least one of them” with more; the invalid values, read from the marked pages’ rows with the detector’s `isValidHreflang`; Google’s hreflang page. Change: the same full set on each page, then a step per condition. An x-default is called recommended, not required.',
    verify:
      'On the first marked page (`needsOf`, `hreflangHolds`): passes when its `<head>` lists the page under a value with the form of a language code, holds no value of another form, names the members that name it and that it does not name back, no longer carries its invalid values or the alternates that redirect or are gone, and holds an `x-default` when the record proves one missing. The builder throws when that page’s annotations were not read.',
    see: 'The page’s `<link … hreflang …>` tags. `today` lists the tags as the crawl read them, up to a bound.',
    stated: [
      'Google recommends an x-default and does not require one; the audit keeps the fix open until one is present, so the command asks for it (`expect`).',
      'It reads `<link>` elements in the `<head>`; annotations in an HTTP Link header or a sitemap are not read, no alternate is requested, and a value is checked for its form, not against the registry of codes (`expect`).',
      'The command reads the first of the pages marked (`expect`).',
      'When the URLs and values do not fit the command’s length, how many it leaves out (`expect`).',
    ],
    unsaid: ['Which marked page carries which condition, when more than one is marked.'],
  },
};

/**
 * Limits that are open at this commit: from round 3 of the review, and from reading the builders for
 * this document. `SHARED_LIMITS` holds the ones several types share, each with its types;
 * `OPEN_LIMITS` holds a type's own, one line each. When one is closed, delete it and regenerate.
 */
interface SharedLimit {
  name: string;
  limit: string;
  types: readonly FixType[];
}

const SHARED_LIMITS: readonly SharedLimit[] = [
  {
    name: 'redirect body',
    limit:
      'The exact check follows no redirect, and `curl -f` fails at a status of 400 or more, so the body of a 3xx answer is read: a redirect whose body holds the markup passes (round 3, note 4; confirmed with curl for this document). The structure checks do not share this: their program reads the status curl writes after each page and takes only a 200.',
    types: [
      'client_rendered_template',
      'quotable_opening',
      'specs_as_images',
      'missing_schema_description',
      'no_question_headings',
      'missing_author_date',
    ],
  },
  {
    name: 'path-end “See it”',
    limit:
      'Where the readable command prints the `<a>` tags that hold a page’s path, it matches the end of the path: a link to another page whose path ends the same way (`/blog/deep` for `/deep`), or to that path on another host, is printed too, on a page where `today` says nothing is; and a link written without quotes is not printed. The exact check reads neither wrongly (re-review after round 3, S4).',
    types: ['orphan_pages', 'deep_pages', 'redirect_chain', 'canonical_mismatch'],
  },
];

const OPEN_LIMITS: { readonly [K in FixType]: readonly string[] } = {
  robots_txt_blocks_crawler: [],
  edge_rule_blocks_crawler: [
    'A 200 that carries a block or challenge page passes unless it has one of the mitigation headers the check reads. `expect` says so.',
  ],
  client_rendered_template: [
    'The exact check’s word count takes the text outside the skipped elements, wherever it is on the page: a page with that much static text outside its main content passes unfixed. `expect` says so.',
    'The readable command’s count is rough: it keeps menus, headers and footers, and the text after a `<` inside a script’s code. `today` says so and points at the exact check’s count.',
  ],
  orphan_pages: [],
  quotable_opening: [],
  generic_anchor_text: [],
  deep_pages: [
    'With no page the audit can vouch for, the exact check reads the page the developer names in a shell variable and exits non-zero until it is set. `expect` says so.',
  ],
  specs_as_images: [
    'The exact check does not read what the cells say: a table of anything passes it.',
  ],
  missing_schema_description: [],
  no_question_headings: [],
  missing_author_date: [],
  js_only_navigation: [],
  redirect_chain: [],
  duplicate_pagination: [
    'The content check asks each page for two same-site links of its own that the other lacks. A later page that repeats the first page’s items and also holds two such links of its own passes it, while the audit’s content hash still finds the pages alike: a pass before the fix. `expect` says so. D3 does not allow it, and no one-line check of links closes it (the audit’s signal is the content hash); it stands as a disclosed limit for the owner to accept or refuse (§12).',
  ],
  canonical_mismatch: [],
  hreflang_gap: [],
};

/** Documentation behind lines of a generic body, which a builder exports beside its `stacks`. */
const GENERIC_SOURCES: Readonly<Partial<Record<FixType, readonly DocSource[]>>> = {
  edge_rule_blocks_crawler: EDGE_VENDOR_SOURCES,
  missing_schema_description: missingSchemaDescriptionSources,
  missing_author_date: missingAuthorDateSources,
};
const GENERIC_SOURCES_LABEL: Readonly<Partial<Record<FixType, string>>> = {
  edge_rule_blocks_crawler: '`generic`, the Cloudflare steps',
};

const sourceLine = (s: DocSource): string =>
  `  - [${s.title}](${s.url}), read ${s.read}. Supports: ${s.supports}.`;

/** The documentation a type's bodies cite, grouped by body, and the Google pages its builder names. */
function sourcesList(type: FixType): string[] {
  const entry = PACKETS[type];
  if (entry.kind === 'none') return [];
  const groups: string[] = [];
  const add = (body: string, sources: readonly DocSource[]) => {
    if (sources.length > 0) groups.push([`- ${body}:`, ...sources.map(sourceLine)].join('\n'));
  };
  add(GENERIC_SOURCES_LABEL[type] ?? '`generic`', GENERIC_SOURCES[type] ?? []);
  for (const framework of STACKS) add(code(framework), entry.stacks[framework]?.sources ?? []);
  const builder = sourceOf(`packets/by-type/${kebab(type)}.ts`);
  for (const [key, page] of Object.entries(GOOGLE_DOCS)) {
    if (builder.includes(`GOOGLE_DOCS.${key}`)) {
      groups.push(`- Printed in the packet’s own text (\`GOOGLE_DOCS.${key}\`): ${page}`);
    }
  }
  return groups.length === 0
    ? ['Documentation cited: none.', '']
    : ['Documentation cited:', '', groups.join('\n'), ''];
}

function bodiesOf(type: FixType): string[] {
  const entry = PACKETS[type];
  if (entry.kind === 'none') return [];
  return ['generic', ...STACKS.filter((f) => entry.stacks[f] !== undefined)];
}

function typeSection(type: FixType, lab: Map<FixType, Written>, labFixes: readonly FixtureFix[]) {
  const entry = PACKETS[type];
  const notes = NOTES[type];
  const list = (title: string, items: readonly string[]) =>
    items.length === 0 ? [] : [`${title}:`, '', bullets(items), ''];
  const example = lab.get(type);
  const inFixture = labFixes.filter((f) => f.type === type).length;
  const shared = SHARED_LIMITS.filter((l) => l.types.includes(type));
  const cut =
    example === undefined
      ? []
      : [example.packet.verify.expect, ...example.packet.context, ...example.packet.change].filter(
          (l) => l.includes('(line cut from '),
        );
  return [
    `### ${code(type)}`,
    '',
    ...(entry.kind === 'none' ? [`Registry reason: ${entry.reason}`, ''] : []),
    ...(notes.rule === '' ? [] : [`**Rule.** ${notes.rule}`, '']),
    ...(notes.verify === '' ? [] : [`**Exact check.** ${notes.verify}`, '']),
    ...(notes.see === '' ? [] : [`**See it.** ${notes.see}`, '']),
    ...(entry.kind === 'none' ? [] : [`Run in two states by ${file(twoStateTest(type))}.`, '']),
    ...list('Limits the packet states', notes.stated),
    ...list('Open limits', [
      ...OPEN_LIMITS[type],
      ...(shared.length === 0
        ? []
        : [`Shared, from the list above: ${shared.map((l) => `**${l.name}**`).join(', ')}.`]),
      ...(cut.length === 0
        ? []
        : [
            `In the example below ${cut.length === 1 ? 'a line passes' : `${cut.length} lines pass`} \`PACKET_BOUNDS.line_chars\` and ${cut.length === 1 ? 'is' : 'are'} cut mid-sentence (found when this document was rendered).`,
          ]),
    ]),
    ...list('Not said, because not measured', notes.unsaid),
    ...sourcesList(type),
    ...(example === undefined
      ? [`Lab fixture: no fix of this type.`]
      : [
          `Fixes of this type in the lab fixture: ${inFixture}. The first, as stored:`,
          '',
          packetBlock(example),
        ]),
  ].join('\n');
}

// --- §6: the detector ------------------------------------------------------------------------------

type State = NonNullable<PageResult['without_js']>['state'];

/** The graded pages of the template the state table is computed on. */
const TABLE_PAGES = 4;

const REASON_MEANING: Readonly<Record<RenderedIndeterminateReason, string>> = {
  not_rendered: 'no page of the template was rendered',
  pages_disagree: 'some rendered pages are empty shells and some are not',
  template_absent:
    'an awaiting fix names the template, and the check has no graded or empty-root page of it',
};

/** The detector's verdict on a template of TABLE_PAGES graded pages, the first of which were rendered as `states`. */
function verdictOn(states: readonly State[]) {
  const SHARE: Record<State, number> = { empty_shell: 0.1, partial: 0.5, readable: 0.9 };
  const pages: RenderedInputPage[] = Array.from({ length: TABLE_PAGES }, (_, i) => {
    const state = states[i];
    return {
      url: `https://a.test/t/${i}`,
      template_key: '/t/{slug}',
      kind: 'content',
      status_code: 200,
      is_html: true,
      without_js:
        state === undefined
          ? null
          : {
              raw_words: SHARE[state] * 100,
              rendered_words: 100,
              text_share: SHARE[state],
              state,
            },
    };
  });
  const [record] = detectRendered(pages);
  if (record === undefined) throw new Error('packets spec: the detector gave no record');
  return record;
}

function detectorTable(): string {
  const cases: readonly (readonly State[])[] = [
    ['empty_shell', 'empty_shell'],
    ['empty_shell'],
    ['readable', 'partial'],
    ['empty_shell', 'readable'],
    [],
  ];
  const records: { states: readonly State[] | 'absent'; record: RenderedDetection }[] = [
    ...cases.map((states) => ({ states, record: verdictOn(states) })),
    { states: 'absent', record: detectRendered([], { openTemplates: ['/t/{slug}'] })[0]! },
  ];
  for (const reason of RENDERED_INDETERMINATE_REASONS) {
    if (!records.some((r) => r.record.reason === reason)) {
      throw new Error(`packets spec: no case of the state table gives ${reason}`);
    }
  }
  return table(
    ['Rendered pages, by `state`', 'Record', 'Reason', 'Fix opens', 'Confidence'],
    records.map(({ states, record }) => [
      states === 'absent'
        ? 'no page present; an awaiting fix names the template'
        : states.length === 0
          ? 'none rendered'
          : codes(states),
      code(record.state),
      record.reason === null ? '' : `${code(record.reason)}: ${REASON_MEANING[record.reason]}`,
      record.state === 'detected' ? 'yes' : 'no',
      record.state === 'detected' ? code(renderedConfidence(record)) : '',
    ]),
  );
}

// --- §7: the rule lists ----------------------------------------------------------------------------

/** One line per distinct rule, in the registry's order, with the fix types that share it. */
function byRule(cells: (type: FixType) => [value: string, rule: string]): string[] {
  const rows = new Map<string, { types: FixType[]; cells: [string, string] }>();
  for (const type of FIX_TYPES) {
    const own = cells(type);
    const key = own.join('\u0000');
    const row = rows.get(key) ?? { types: [], cells: own };
    row.types.push(type);
    rows.set(key, row);
  }
  return [...rows.values()].map((r) => `${codes(r.types)}: ${r.cells[0]}. ${r.cells[1]}`);
}

// --- §8: stack detection ---------------------------------------------------------------------------

/** What each signal of a CMS in FRAMEWORK_OF_CMS also matches, by `cms:pattern`. */
const SIGNAL_NOTES: Readonly<Record<string, string>> = {
  'wordpress:\\/wp-content\\/':
    'Matched anywhere in the homepage HTML, on any host. A headless WordPress whose front end is another framework still links its media under `/wp-content/uploads/`; so does a page that embeds a file from another site’s WordPress.',
  'wordpress:\\/wp-includes\\/': 'The same matcher: any URL in the HTML that holds the path.',
  'wordpress:\\/wp-json\\/':
    'Any URL that holds the path: a front end that links to, or calls, a WordPress REST API.',
  'wordpress:<meta\\s+name=["\']generator["\']\\s+content=["\']WordPress':
    'A generator tag with `name` before `content`. A front end that prints the tag of the CMS behind it matches.',
  'wordpress:x-pingback':
    'A response header of the homepage whose value holds `xmlrpc.php`. A proxy that passes a WordPress origin’s headers through sends it for a page another front end rendered.',
  'webflow:data-wf-(?:page|site)=':
    'An attribute Webflow writes, matched as text anywhere in the HTML: a page that prints the attribute in a code sample matches.',
  'webflow:<meta\\s+name=["\']generator["\']\\s+content=["\']Webflow':
    'A generator tag with `name` before `content`.',
  'webflow:assets(?:-global)?\\.website-files\\.com':
    'An asset host. A page on another platform that loads one file from it matches.',
  'webflow:cdn\\.prod\\.website-files\\.com': 'An asset host, as above.',
  'webflow:uploads-ssl\\.webflow\\.com': 'An asset host, as above.',
  'webflow:server': 'The `server` response header, matched whole against `Webflow`.',
};

function signalLines(): string[] {
  const lines: string[] = [];
  for (const sig of SIGNATURES) {
    if (!Object.hasOwn(FRAMEWORK_OF_CMS, sig.cms)) continue;
    const note = (key: string): string => {
      const text = SIGNAL_NOTES[`${sig.cms}:${key}`];
      if (text === undefined) throw new Error(`packets spec: no note for ${sig.cms}:${key}`);
      return text;
    };
    for (const p of sig.htmlPatterns ?? []) {
      lines.push(`${code(sig.cms)}, HTML, ${span(p.source)}. ${note(p.source)}`);
    }
    for (const h of sig.headerPatterns ?? []) {
      const pattern = h.pattern === 'present' ? 'present' : span(h.pattern.source);
      lines.push(`${code(sig.cms)}, header ${code(h.name)}, ${pattern}. ${note(h.name)}`);
    }
  }
  return lines;
}

function frameworkRows(): string[][] {
  return Object.entries(FRAMEWORK_OF_CMS).map(([cms, framework]) => {
    const withBody = FIX_TYPES.filter((type) => {
      const entry = PACKETS[type];
      return (
        entry.kind === 'builder' && framework !== 'generic' && entry.stacks[framework] !== undefined
      );
    });
    return [code(cms), code(framework), or(codes(withBody), 'none: the generic body is first')];
  });
}

// --- §9: voice -------------------------------------------------------------------------------------

interface Voice {
  hand: string;
  engine: string;
  why: string;
  weaker: string;
}

/** The differences that matter, for each fix type both fixtures hold a packet for. */
const VOICE: Readonly<Partial<Record<FixType, Voice>>> = {
  edge_rule_blocks_crawler: {
    hand: 'Names the product, the dashboard path, a rule by its name and its expression. More than one crawler in one packet. The command prints the status for the reader to compare with “200 (today: 403)”.',
    engine:
      'One crawler per fix. States the pages refused of the pages sampled, the status tally, the identity that was served, and that the request was tagged. Names no product: the lab check recorded no edge vendor. The first step asks whether the crawler should be let in. “See it” prints the status; the exact check exits 0 on a 200 with no challenge header.',
    why: 'The record holds no rule name, expression or dashboard location.',
    weaker: '“Find the rule” where the hand-written packet points at it. No effort is stated.',
  },
  orphan_pages: {
    hand: 'Several pages in one packet, grouped by edit, with a CMS admin path, component files and a cause (a draft flag). The proof is “crawl, then count”.',
    engine:
      'One page per fix: the crawled pages that answered 200 and do not link to it, one suggested parent with how it was ranked and how far it is from the homepage, and commands that read the parent for the link.',
    why: 'The detector reports one record per page, and the record holds no file, CMS state or cause.',
    weaker:
      'A site with several orphans gets as many packets of one link. A packet does not say why its page is unlinked, and pages that share an edit are not grouped.',
  },
  deep_pages: {
    hand: 'Several pages in one sentence; “link each from its collection page, or from the footer”. The proof is “crawl, then measure click depth”.',
    engine:
      'One page per fix: its clicks or that no path reaches it, a page to link from with why that one, and commands that read that page for the link. `expect` says the depth is measured on the next check.',
    why: 'Depth is a property of the whole graph; a `curl` reads one page.',
    weaker:
      'The page it names is chosen on the crawl’s links, not by an editor; the change says another page as close does as well. The command does not prove the depth.',
  },
  canonical_mismatch: {
    hand: 'More than one page in one packet. Names a file and the cause (the canonical is built from the first collection). The command prints the tag for the reader to compare with “the page’s own URL”.',
    engine:
      'One page per fix: the declared canonical, what the crawl found at it, the canonical read from the rows as the one to set, “See it” printing the tag, and an exact check that exits 0 when the head holds one canonical naming it. A Next.js body cites `alternates.canonical`.',
    why: 'The record holds no file and no cause.',
    weaker:
      'It does not say why the canonical is wrong. The page’s own URL is offered as the default, which is a reading of intent the change labels as one.',
  },
  redirect_chain: {
    hand: 'One sentence of context, one of change. The proof is “crawl, then follow the link”.',
    engine:
      'The linking pages, the hops with status and Location, where the chain ends, the edit per linking page, “See it” printing the links, and an exact check that reads the first linking page for the new target and the absence of the old.',
    why: 'The check’s row for the URL holds the hops.',
    weaker:
      'Longer. The commands cover the first linking page and ask the reader to run them for the others.',
  },
  duplicate_pagination: {
    hand: 'Describes collection pages that answer with and without `?page=1`, and a redirect as the fix. The proof is “crawl the collections”.',
    engine:
      'Later pages that repeat their first page: by a canonical set to the first page, or by near-identical content. A step per condition, and commands on the first later page.',
    why: `The two describe different defects. The engine’s detector does not report the hand-written case: \`firstPageOf('https://a.test/c?page=1')\` gives ${code(String(firstPageOf('https://a.test/c?page=1')))} when this document is rendered.`,
    weaker:
      'The content part of the exact check is a proxy (links, not text), and `expect` says the hash is measured on the next check.',
  },
  hreflang_gap: {
    hand: 'One page and one missing return tag, in a sentence of context and one of change. The proof is “crawl the hreflang pairs”.',
    engine:
      'The cluster, the marked pages, a sentence and a step per condition held, the full reciprocal set as the target, “See it” printing the tags the crawl read, and an exact check on the first marked page.',
    why: 'The record holds the cluster’s conditions as a union.',
    weaker:
      'With more than one marked page it says “At least one of them”: it does not say which page carries which defect.',
  },
};

const sizeOf = (p: Packet): number =>
  [
    ...p.context,
    ...p.change,
    ...p.keep,
    p.verify.command,
    p.verify.expect,
    ...(p.verify.see === null
      ? []
      : [p.verify.see.command, p.verify.see.today, p.verify.see.after]),
  ].join('').length;

function voiceSection(lab: Map<FixType, Written>, hand: Map<FixType, Written>): string[] {
  const both = FIX_TYPES.filter((t) => lab.has(t) && hand.has(t));
  for (const type of Object.keys(VOICE) as FixType[]) {
    if (!both.includes(type))
      throw new Error(`packets spec: ${type} is compared and not in both fixtures`);
  }
  const handOnly = FIX_TYPES.filter((t) => hand.has(t) && !lab.has(t));
  const labOnly = FIX_TYPES.filter((t) => lab.has(t) && !hand.has(t));
  const neither = FIX_TYPES.filter((t) => !lab.has(t) && !hand.has(t));
  const effort = (f: FixtureFix) => (f.effort === null ? 'none' : span(json(f.effort)));
  const seeOf = (f: Written) => (f.packet.verify.see === null ? 'none' : 'yes');
  const compared = both.map((type) => {
    const [h, e] = [hand.get(type)!, lab.get(type)!];
    const v = VOICE[type];
    if (v === undefined)
      throw new Error(`packets spec: ${type} is in both fixtures and not compared`);
    return [
      `#### ${code(type)}`,
      '',
      bullets([
        `Hand-written command: ${span(h.packet.verify.command)}`,
        `\`ua\`: ${h.packet.verify.ua ?? 'none'} / ${e.packet.verify.ua ?? 'none'}. “See it”: ${seeOf(h)} / ${seeOf(e)}. Effort: ${effort(h)} / ${effort(e)}. Bodies: ${1 + h.packet.packets.length} / ${1 + e.packet.packets.length}. Characters: ${sizeOf(h.packet)} / ${sizeOf(e.packet)}.`,
        `Hand-written says: ${v.hand}`,
        `Engine says: ${v.engine}`,
        `Why they differ: ${v.why}`,
        `Where the engine is weaker: ${v.weaker}`,
      ]),
    ].join('\n');
  });
  const notCurl = both.filter((t) => !hand.get(t)!.packet.verify.command.startsWith('curl'));
  // The lab fixture's page with both an orphan fix and a deep fix, and the page each packet names.
  const orphan = lab.get('orphan_pages');
  const deep = lab.get('deep_pages');
  // A code span is the text between two backticks: the odd pieces of a line split on them.
  const spans = (text: string | undefined): string[] =>
    (text ?? '').split('`').filter((_, i) => i % 2 === 1);
  const [subject, orphanParent] = spans(orphan?.packet.change[0]);
  const [deepParent] = spans(deep?.packet.change[1]);
  const samePage =
    orphan !== undefined &&
    deep !== undefined &&
    subject !== undefined &&
    deep.title.includes(subject);
  return [
    `Reference: the hand-written packets of ${file(HAND_FIXTURE)} (\`fixes[].packet\`). Engine: ${file(LAB_FIXTURE)}, the first fix of a type. Which types are compared comes from iterating the two files: a type is compared when both hold a packet for it.`,
    '',
    bullets([
      `In both files: ${or(codes(both), 'none')}.`,
      `A hand-written packet and no engine packet in the lab fixture: ${or(codes(handOnly), 'none')}.`,
      `An engine packet in the lab fixture and no hand-written one: ${or(codes(labOnly), 'none')}.`,
      `In neither: ${or(codes(neither), 'none')}.`,
    ]),
    '',
    'Per type, values read from the two files as hand-written / engine. “Characters” is the length of context, change, keep, both commands and their texts in the first body. The sentences under each are written in spec.ts (`VOICE`).',
    '',
    compared.join('\n\n'),
    '',
    '#### Across the types',
    '',
    `The hand-written packets name files, dashboard paths, rule names and causes, and group pages that share an edit. The records (${file('packets/types.ts')} \`RecordOf\`) have no field for those, so a builder has nothing to say them from. The engine’s packets are longer, state their sample, and carry a command to read beside the one that exits by status. Hand-written commands among the compared types that do not start with \`curl\`: ${or(codes(notCurl), 'none')}.`,
    '',
    ...(samePage && orphan !== undefined && deep !== undefined
      ? [
          `One page of the lab fixture has an orphan fix and a deep fix. The two packets name ${orphanParent === deepParent ? 'the same page' : 'different pages'} to link from (the first step of the orphan packet, the second of the deep one):`,
          '',
          fenced([orphan.packet.change[0] ?? '', deep.packet.change[1] ?? '']),
        ]
      : ['No page of the lab fixture has both an orphan example and a deep example above.']),
  ];
}

// --- §10 to §12: the rulings, the review record, the questions -------------------------------------

/** The Tier A rounds: the commit each was frozen at and its scores out of 10. */
const REVIEW_ROUNDS: readonly {
  round: number;
  frozen: string;
  seo: number;
  security: number;
  correctness: number;
}[] = [
  { round: 1, frozen: '2a2486b4', seo: 5, security: 5, correctness: 6.5 },
  { round: 2, frozen: '07987f9f', seo: 7, security: 7, correctness: 6.5 },
  { round: 3, frozen: '9d1ed7f9', seo: 8, security: 8, correctness: 8 },
];

const score = (n: number): string => String(n);

interface Mutation {
  mutation: string;
  where: string;
  /** A test that went red, as [file, title]; the title is looked up when the document is rendered. */
  red: readonly (readonly [string, string])[];
  note?: string;
}

/** The mutations the brief requires, as round 2's correctness review ran them. */
const MUTATIONS: readonly Mutation[] = [
  {
    mutation: 'A packet names a URL its record does not hold.',
    where: 'packets/by-type/redirect-chain.ts',
    red: [
      [
        'packets/by-type/redirect-chain.test.ts',
        'points the links at the final URL and keeps the redirect',
      ],
    ],
    note: 'The structure tests that went red compare exact text. The content builders have a property for it, “names no URL its record does not hold” (packets/test-support/content.ts); the structure builders have none.',
  },
  {
    mutation:
      'A verify command that passes on the broken fixture (`linksTo` ignores the stale link; `canonicalIs` accepts any canonical).',
    where: 'packets/html-checks.ts',
    red: [
      ['packets/html-checks.test.ts', 'passes on the new target only when the old one is gone'],
      [
        'packets/html-checks.test.ts',
        'fails on two canonicals, one in the body, one commented out, another URL, or none',
      ],
    ],
  },
  {
    mutation: 'A framework listed with no body.',
    where: 'packets/compose.ts',
    red: [
      [
        'packets/compose.test.ts',
        'gives a packet the contract accepts, inside its size bound, listing a framework only with its body',
      ],
    ],
  },
  {
    mutation: 'A hostile path adds a line to the packet (`clean` keeps a line break).',
    where: 'clean-text.ts',
    red: [
      [
        'packets/text.test.ts',
        'removes a line break, a bidirectional mark and a zero-width space, and swaps a backtick',
      ],
      [
        'packets/text.test.ts',
        'leaves nothing crawled outside a code span, and adds no line (property)',
      ],
    ],
  },
  {
    mutation: 'The registry is missing a type.',
    where: 'packets/registry.ts',
    red: [
      ['packets/registry.test.ts', 'has an entry for each fix type of the contract and no other'],
    ],
    note: 'Also a compile error: `tsc --noEmit` reported TS2741 on `PACKETS`.',
  },
  {
    mutation: 'D6 opens a fix on a template that was not rendered.',
    where: 'detectors/rendered.ts',
    red: [
      ['detectors/rendered.test.ts', 'cannot decide when no page of the template was rendered'],
    ],
  },
  {
    mutation: 'A locked packet present in the page’s HTML.',
    where: 'apps/web/lib/v2/view/fix.ts',
    red: [
      ['apps/web/lib/v2/view/fix.test.ts', 'never reads a locked fix’s packet'],
      [
        'apps/web/__tests__/v2/fix.test.tsx',
        'puts no body of a locked fix that holds several in the page',
      ],
    ],
  },
  {
    mutation: '`after` computed by a second formula.',
    where: 'packets/before-after.ts',
    red: [
      [
        'packets/before-after.same-code.test.ts',
        'the edge fix writes no row: the blocked pages stay blocked, so no crawler is added',
      ],
      [
        'packets/before-after.same-code.test.ts',
        'the opening is still not quotable: the failing pages stay failing',
      ],
    ],
    note: 'A third form survived: `SERVER_RENDERED_SHARE` replaced by the literal 1 in the text-share row. It changes nothing while the constant is 1, and no test ties the row to the constant.',
  },
];

function mutationLines(): string[] {
  return MUTATIONS.map(
    (m, i) =>
      `**${i + 1}.** ${m.mutation} Changed: ${file(m.where)}. Red: ${m.red.map(([path, title]) => held(path, title)).join('; ')}.${m.note === undefined ? '' : ` ${m.note}`}`,
  );
}

// --- the document ----------------------------------------------------------------------------------

export function renderPacketSpec(): string {
  const labFixture = fixtureOf(LAB_FIXTURE);
  const labFixes = labFixture.fixes;
  const lab = firstPackets(labFixes);
  const handWritten = writtenIn(fixtureOf(HAND_FIXTURE).fixes);
  const hand = firstPackets(handWritten);
  const sources = gradeSources();
  const guarded = sources.filter((f) => f.startsWith('v2/packets/'));
  const scored = Object.entries(CONTENT_CHECKS).filter(([, def]) => def.scored);
  const exampleTitle = titleOf('client_rendered_template', '/guides/{slug}');
  const grading = (labFixture.summaries ?? []).find((s) => s.phase === 'grading');
  if (grading === undefined || !('packets_not_written' in grading)) {
    throw new Error('packets spec: the lab fixture’s grading summary holds no packets_not_written');
  }
  const none = FIX_TYPES.filter((t) => PACKETS[t].kind === 'none');
  const labWritten = writtenIn(labFixes);
  const withSee = (fixes: readonly Written[]) =>
    fixes.filter((f) => f.packet.verify.see !== null).length;
  const testable = CRAWLER_REGISTRY_V2.filter((e) => e.testable);

  return `${[
    '# SPEC 30 — Fix packets, before and after, and effort, written by the engine',
    '',
    `> Generated from ${file('packets/spec.ts')}; \`spec.test.ts\` fails when this file differs from the render.`,
    '> Regenerate: `pnpm --filter @crawlmouse/engine exec tsx src/v2/packets/write-spec.ts`.',
    '> Lists of names, numbers, sources, rules and the example packets are read from the code and the fixtures',
    '> when the file is rendered. The decisions, the per-type notes, the open limits, the review record and the',
    '> comparison are written in spec.ts and checked by review; a file or a test title they name is looked up at',
    `> render, and a missing one throws. A path without a root is under \`${V2}\`. Questions (Q1 to Q10) are in`,
    '> the step’s `questions.md`, the owner’s answers in `rulings.md`, `rulings-2.md` and `rulings-3.md`; §12 carries both.',
    '',
    '## 1. What this step does',
    '',
    'Before this step a fix carried `packet: null`, `effort: null` and `before_after: []`. The engine now writes the three when it opens a fix, from the fix’s own record and the check’s rows, with no model call. A packet says what is wrong with the evidence, the change to make, what to keep, a short command that prints the evidence (“See it”) and a strict command whose exit status says whether the fix has landed (“Exact check”). The rendered-page fix type `client_rendered_template` opens with it. The fix page, the prompt and the download show what the packet holds.',
    '',
    '## 2. Decisions',
    '',
    DECISIONS.map((d) =>
      [
        `- **${d.id}. ${d.decision}** ${d.built}`,
        ...(d.where.length === 0 ? [] : [`  - Where: ${files(d.where)}.`]),
        ...(d.tests.length === 0 ? [] : [`  - Held by: ${files(d.tests)}.`]),
      ].join('\n'),
    ).join('\n'),
    '',
    '## 3. How a packet is built',
    '',
    `The registry (${file('packets/registry.ts')}), one row per fix type of the contract:`,
    '',
    table(
      ['Fix type', 'Entry', 'Bodies'],
      FIX_TYPES.map((type) => [
        code(type),
        PACKETS[type].kind === 'builder' ? 'builder' : 'none',
        codes(bodiesOf(type)),
      ]),
    ),
    '',
    'The reason each entry without a builder carries:',
    '',
    bullets(
      none.map((type) => {
        const entry = PACKETS[type];
        return `${code(type)}: ${entry.kind === 'none' ? entry.reason : ''}`;
      }),
    ),
    '',
    `A builder (${file('packets/types.ts')}) has these fields, functions of one record and the check’s \`PacketFacts\` (the homepage URL, the stack, the crawlers’ site verdicts, the pages, the links and the access tests):`,
    '',
    bullets([
      '`context(fix, facts)`: what is wrong, with the evidence; shared by the bodies.',
      '`generic(fix, facts)`: the change and what to keep, on any stack.',
      '`stacks[framework]`: `write(fix, facts)`, the change on that stack, or null when it has none for this record; and `sources`, the documentation pages its steps rest on.',
      '`verify(fix, facts)`: the exact check, what to expect, the crawler requested as, and `see`, the readable command with what it prints today and after; shared by the bodies.',
    ]),
    '',
    `\`compose\` (${file('packets/compose.ts')}) writes a body for a stack whose \`write\` returns a change, in the contract’s order (${codes(STACKS)}), then \`generic\`. The first body is the one for \`frameworkOf(facts.stack)\` when the builder wrote it, else \`generic\`. \`frameworks\` is the first body’s framework followed by the others’.`,
    '',
    `Bounds, read from \`PACKET_BOUNDS\` (compose.ts), \`COMMAND_BOUNDS\` (${file('packets/html-checks.ts')}) and the constants below:`,
    '',
    bullets([
      ...boundLines('PACKET_BOUNDS', PACKET_BOUNDS),
      ...boundLines('COMMAND_BOUNDS', COMMAND_BOUNDS),
      `\`MAX_CRAWLED_CHARS\` = ${MAX_CRAWLED_CHARS}. Code points of one crawled text in a line or a command word, unless the caller asks for less.`,
      `\`MAX_TITLE_CHARS\` = ${MAX_TITLE_CHARS}. Code points of a fix title (grade/outcomes.ts \`titleOf\`); a longer one is cut and ends in an ellipsis.`,
    ]),
    '',
    `A command is not cut by \`compose\`: a cut command is a different command. Its length is bounded where it is written, by \`COMMAND_BOUNDS\`. Held by ${held('packets/compose.test.ts', 'stays under the stated bound for URLs of the worker’s longest and the largest records')}.`,
    '',
    `How text reaches a packet (D8; ${files(['clean-text.ts', 'packets/text.ts', 'packets/shell.ts'])}):`,
    '',
    bullets(TEXT_RULES.map(([fn, takes, does]) => `${fn}, given ${takes}. ${does}`)),
    '',
    'Hostile text through some of them, as the functions return it when this document is rendered:',
    '',
    textSample(),
    '',
    `Held by ${held('packets/text.test.ts', 'leaves nothing crawled outside a code span, and adds no line (property)')}, ${held('packets/shell.test.ts', 'passes crawled text to the shell as its cleaned self and runs none of it (property)')}, ${held('packets/compose.test.ts', 'lets nothing crawled add a line, draw nothing, or stand outside a code span')} and ${held('packets/html-checks.test.ts', 'is one line with nothing unshown in it, and runs nothing a value holds')}.`,
    '',
    '### Builder faults',
    '',
    `\`writtenFrom(facts, onFault)\` (${file('packets/written.ts')}) is what the check builder hands to \`detectorOutcomes\` (${file('build/grade.ts')}). It writes a fix’s packet, effort and before/after rows. When a builder throws on a record, the fix carries \`packet: null\`, the check is still built, and \`onFault\` is told the fix type, the fingerprint and the error; the effort and the rows are written as for any fix. The check builder counts the faults in the grading summary as \`packets_not_written\` (${file('build/summaries.ts')}). In the lab fixture’s grading summary: \`packets_not_written\` ${json(grading.packets_not_written)}, \`fixes_written\` ${json(grading.fixes_written)}.`,
    '',
    bullets([
      `The catch and the listener: ${held('packets/written.test.ts', 'leaves a fix without a packet, and does not throw, on %s')}.`,
      `A throw the catch would hide is looked for by calling the registry’s writer itself over generated crawls: ${held('packets/structure-fuzz.test.ts', 'write a packet the contract accepts for every record a detector reports as detected')}.`,
      `The count in the summary is compared as part of the fixture: ${held('build/build.test.ts', 'gives exactly expected.json')}. A builder made to throw, through the whole check builder: ${held('build/packet-faults.test.ts', 'counts the faults in the grading summary')}.`,
      `The fix page says of such a fix that its last check wrote no steps: ${held('apps/web/lib/v2/view/packet-reason.test.ts', 'says the last check wrote no steps when the type has a builder, and promises no later ones')}.`,
    ]),
    '',
    '### Why the grade code does not import the builders',
    '',
    `\`detectorOutcomes\` (grade/outcomes.ts) takes the writer as an argument (\`WriteFix\`). The reason is the grade-change guard (${file('grade/grade-guard.test.ts')}), which digests the files the grade code imports at run time: a change to a packet’s wording then leaves the digest alone. Of \`packets/\`, \`gradeSources()\` lists: ${or(codes(guarded), 'none')}. It lists \`v2/clean-text.ts\`: ${sources.includes('v2/clean-text.ts') ? 'yes' : 'no'} (the fix titles are cleaned by it).`,
    '',
    '## 4. The verify block',
    '',
    '### “See it” above “Exact check” (owner ruling 1)',
    '',
    bullets([
      '**See it** (`verify.see`): a short command a developer reads in ten seconds. It prints the evidence. `today` says what it prints now, from the record; `after` says what it prints once the fix has landed. Its exit status proves nothing.',
      '**Exact check** (`verify.command`): one line for a POSIX shell that starts with `curl` and exits 0 once the fix has landed. `expect` says what the exit status means and what the command reads. It is the command the tests run in both states.',
    ]),
    '',
    `Both are made by \`sh\` from quoted words (§3), and \`today\`, \`after\` and \`expect\` are lines held to \`PACKET_BOUNDS.line_chars\`. The builder type requires the layer (\`Verify.see\` in types.ts), so a builder without one fails \`pnpm --filter @crawlmouse/engine exec tsc --noEmit -p .\`. In the lab fixture ${withSee(labWritten)} of ${labWritten.length} packets carry it; in the hand-written fixture ${withSee(handWritten)} of ${handWritten.length}.`,
    '',
    '### The contract change: OWNER-APPROVED NON-ADDITIVE CHANGE to `packages/types`',
    '',
    `\`PacketBodySchema.verify\` (${file('packages/types/src/v2/fix.ts')}) gained a required, nullable key: \`see: { command, today, after } | null\`. It is not additive: a packet without the key no longer parses. The owner approved it on Q8 (2026-11-12, \`rulings-2.md\`), for the reasons the ruling gives: the contract forbids optional keys (${held('packages/types/src/v2/contract.test.ts', 'no field anywhere in the contract is optional')}); \`site_fixes.packet\` is \`jsonb\`, so no migration is needed; and, in the ruling’s words, “every packet stored so far is \`null\`” (\`draft()\` wrote \`packet: null\` before this step).`,
    '',
    bullets([
      'Commit `23781149`: the contract (`packages/types/src/v2/fix.ts`).',
      'Commit `1635efcb`: the hand-written fixtures gain `"see": null`, and `docs/specs/v2/11-type-contract.md` is regenerated.',
      'No migration.',
    ]),
    '',
    '### The two-state harness',
    '',
    `${file('packets/test-support/verify.ts')}: \`twoStateSite\` serves a broken and a fixed state on a local port, \`runCommand\` runs a command as written with \`sh -c\` and a time limit, and \`inBothStates\` returns the two results. A command whose site is not there fails: ${held('packets/test-support/verify.test.ts', 'fails a command whose site is not there, rather than passing it')}. The test that runs each type’s exact check in both states is named under the type in §5; this document throws at render when a builder’s test file runs no command.`,
    '',
    '### The crawler requested as',
    '',
    `\`verifyCrawler(facts, fixed)\` (${file('packets/crawler.ts')}) gives the crawler a command requests as: the crawler the fix itself lets in when \`fixed\` names a testable one, else the first testable crawler, in registry order, whose site verdict is \`allowed\` or \`allowed_thin\`; null when there is none, and the command then sends no \`-A\` and \`ua\` is null. \`userAgentOf\` gives the header: the operator’s published string, or the token where the operator prints none.`,
    '',
    table(
      ['Token', 'Group', 'Testable', 'Published user-agent string'],
      CRAWLER_REGISTRY_V2.map((e) => [
        code(e.token),
        code(e.group),
        e.testable ? 'yes' : 'no',
        e.ua_string === null ? 'no' : 'yes',
      ]),
    ),
    '',
    'The header a command sends, for each testable crawler:',
    '',
    bullets(testable.map((e) => `${code(e.token)}: ${span(userAgentOf(e))}`)),
    '',
    '### The address a command requests: `servedAt` and `readAt`',
    '',
    `The engine names a page by its canonical spelling, which drops a trailing slash; a site that redirects that spelling answers a request for it with a redirect, and a command follows none. ${file('packets/served-at.ts')}:`,
    '',
    bullets([
      '`servedAt(facts, url)`: the address a page is **named** at in a line. The row’s `final_url` when it is the same page (it canonicalises to the page’s URL) and carries no credentials; else the page’s URL.',
      '`readAt(facts, url)`: the address a command **requests** to read a page. Where the request for the page ended, when that answered 200 at an address of the page’s own site (`sameSite`: the page’s scheme or https, no credentials, the page’s host give or take a leading `www.`, the page’s port); else `servedAt`. A homepage that answers at `/en/` is requested there.',
    ]),
    '',
    `Held by ${held('packets/served-at.test.ts', 'is the slashed address when the server redirects the page to it')} and ${held('packets/served-at.test.ts', 'is where the request ended, when that answered 200: a homepage that redirects to /en/')}.`,
    '',
    '### The structure reader',
    '',
    `The structure exact checks (${file('packets/html-checks.ts')}) are one \`curl -sS -f --compressed\` of each page with \`-w\` writing ${code(PAGE_END)} and the address requested after each response, \`tr\` making the response one line, and one \`awk\` program under \`LC_ALL=C\` (\`holds\`). A command that asks two things asks them in one program. The lists below are read out of a command built when this document is rendered; the rest is written here from the awk source and held by ${file('packets/html-checks.test.ts')}.`,
    '',
    bullets([
      `**What it strips.** Comments and markup declarations, and the bodies of ${codes(READER.unread)} elements (\`scan\`). A \`>\` inside a quoted attribute value does not end its tag. A tag whose quotes do not close within a few \`<\` stops the reading, and the command exits non-zero (\`odd\`).`,
      `**What it will not read.** An href or a link text longer than ${CAP} bytes (\`CAP\`), a query of more than ${MAX_PARAMS} parameters (\`MAX_PARAMS\`), and a tag of more than ${MAX_ATTRS} attributes (\`MAX_ATTRS\`): the program does not read them, and where a stale link is asked about it takes what it cannot read for the old link, so the command exits non-zero. \`curl\` writes a line after each page, with its status and address; the program takes a page whose status is 200, counts the lines against the pages requested, and exits non-zero when they differ, as they do when a page prints that line itself. Content between \`<noscript>\` tags does not end the head. The request ends after 20 seconds (\`--max-time\`).`,
      `**Attributes.** The first attribute of a name counts, in double quotes, in single quotes or unquoted (\`attrs\`).`,
      `**What it decodes.** Numeric character references, and these named ones: ${codes(READER.named)} (\`ent\`). Another named reference is left as written and flagged (\`unk\`); \`linksTo\` then counts the href as the old link when it was asked about one.`,
      `**What it keeps escaped.** Percent-escapes are decoded for comparison, except ${READER.kept.map(escapeShown).join(', ')}, which stay escaped, in upper case (\`dec\`).`,
      '**How it resolves a URL.** As a browser does (`res`): against the address requested, or the page’s first `<base href>`; document-relative, root-relative, protocol-relative and absolute; a backslash before the query as a slash; dot segments removed; scheme and host in lower case; a default port dropped; the fragment dropped.',
      '**How it compares two URLs.** By `norm`: empty path segments and the slash that ends a path dropped; the query’s parameters sorted, an empty query none and `a` read as `a=`; escapes as above. `sameInCommand` is the same rule in TypeScript, which a builder asks before it writes a command that must tell two URLs apart.',
      `**Where the head ends.** At the first tag that is not one of ${codes(READER.head)}, or at text (\`hd\`). A canonical or an hreflang \`<link>\` after that is not read.`,
      '**What it does not read.** An HTTP `Link` header; a sitemap; markup a script adds; a host written in Unicode is not converted to its ASCII form.',
    ]),
    '',
    `What \`sameInCommand\` answers for pairs of URLs, computed when this document is rendered (held to the awk programs by ${held('packets/html-checks.test.ts', 'compares as the awk programs do (property)')}):`,
    '',
    bullets(
      URL_PAIRS.map(
        ([a, b]) => `${code(a)} and ${code(b)}: ${sameInCommand(a, b) ? 'one URL' : 'two URLs'}`,
      ),
    ),
    '',
    `The structure “See it” commands (${file('packets/structure.ts')} \`seeTags\`) request the same address as the same crawler (\`printOf\` in ${file('packets/html-checks.ts')}), put the page on one line, and print the matches of one of these patterns with \`grep -io\` (\`TAGS\`):`,
    '',
    bullets(Object.entries(TAGS).map(([name, pattern]) => `${code(name)}: ${span(pattern)}`)),
    '',
    '### The content and rendered commands',
    '',
    `The content exact checks (${file('packets/content-rule.ts')} \`tagProbe\`) request the first failing page with \`curl -sSf --compressed\`, at \`readAt\`, turn line breaks into spaces and a \`<\` into a line break, so a line starts with a tag’s name, and hand the lines to an \`awk\` program of ours per type. The content “See it” commands (\`seeMarkup\`) put the same response on one line and print each match of a pattern of ours with \`grep -aioE\`. The \`client_rendered_template\` commands are described under the type.`,
    '',
    'Sentences several packets carry, read from the constants:',
    '',
    bullets([
      `\`CHROME_GAP\` (content-rule.ts): “${CHROME_GAP.text}”`,
      `\`RECHECK\` (content-rule.ts): “${RECHECK.text}”`,
      `\`UNREAD_HREF\` (structure.ts): “${UNREAD_HREF.text}”`,
      `\`CRAWLABLE_LINK\` (structure.ts): “${textOf(CRAWLABLE_LINK)}”`,
    ]),
    '',
    'Google’s pages the structure packets print (`GOOGLE_DOCS`, structure.ts), and the builders whose source names each:',
    '',
    bullets(
      Object.entries(GOOGLE_DOCS).map(([key, page]) => {
        const users = FIX_TYPES.filter(
          (t) =>
            PACKETS[t].kind === 'builder' &&
            sourceOf(`packets/by-type/${kebab(t)}.ts`).includes(`GOOGLE_DOCS.${key}`),
        );
        return `${code(key)}: ${page}. Named by: ${or(codes(users), 'no builder')}.`;
      }),
    ),
    '',
    'What a content packet’s first context line says each check looks for, read by building that line for each check of the contract:',
    '',
    bullets(ContentCheckSchema.options.map((c) => `${code(c)}: ${checkWords(c)}`)),
    '',
    'How the edge packet says each access cause, read by building its context for a record that names the cause:',
    '',
    bullets(AccessCauseSchema.options.map((c) => `${code(c)}: ${causeSentence(c)}`)),
    '',
    '## 5. Per fix type',
    '',
    `In the registry’s order. “Lab fixture” is ${file(LAB_FIXTURE)}, whose \`check.stack\` is ${span(json(labFixture.check?.stack ?? null))}. An example is the stored packet, each string on a line of its own, with the exact check whole.`,
    '',
    `Content checks that count in a grade today (\`CONTENT_CHECKS[check].scored\`): ${or(codes(scored.map(([c]) => c)), 'none')}. A content packet’s context ends with the line that says so.`,
    '',
    CONTENT_SHARED,
    '',
    'Open limits that several types share. Under a type, “Shared” names the ones that apply to it. Each is one entry of `SHARED_LIMITS` in spec.ts, and a type’s own are in `OPEN_LIMITS`: when one is closed, delete it and regenerate.',
    '',
    bullets(SHARED_LIMITS.map((l) => `**${l.name}.** ${l.limit} Types: ${codes(l.types)}.`)),
    '',
    FIX_TYPES.map((type) => typeSection(type, lab, labFixes)).join('\n\n'),
    '',
    '## 6. The `client_rendered_template` detector',
    '',
    `\`detectRendered\` (${file('detectors/rendered.ts')}) gives one record per template key present in the check: a template with a graded page (\`isGraded\`) or an empty-root page (a crawled page \`emptyRoot\` holds for, ${file('render/empty-root.ts')}). Its verdict reads the deciding renders (\`PageResult.without_js\`): the rendered graded pages of a template that has any, and only for a template with no graded page its rendered empty-root pages. It reads the render step’s \`state\` for a page and defines no threshold of its own. The lines \`state\` is drawn on (${file('render/state.ts')}): a page is an \`empty_shell\` below a text share of ${EMPTY_SHELL_BELOW} (\`EMPTY_SHELL_BELOW\`), stays one until its share rises above ${EMPTY_SHELL_LEAVES_ABOVE} (\`EMPTY_SHELL_LEAVES_ABOVE\`), and is \`readable\` from ${READABLE_FROM} (\`READABLE_FROM\`).`,
    '',
    `The detector’s verdict on a template of ${TABLE_PAGES} graded pages, computed when this document is rendered. The reasons it can give (\`RENDERED_INDETERMINATE_REASONS\`): ${codes(RENDERED_INDETERMINATE_REASONS)}.`,
    '',
    detectorTable(),
    '',
    bullets([
      `Key: \`${SHELL_KEY_PREFIX}:<template_key>\`. \`measured\` is the median \`text_share\` of the rendered pages.`,
      `Scope (Q5, CC-32 D2): a route that serves an empty root is classed \`thin\` and is not graded; it is an empty-root page, so its template is present and gets a record, and the empty-root phase renders up to two of its pages (${file('render/empty-root.ts')}). A template with a graded page is judged on its graded renders alone, so its verdict and confidence are what they were before CC-32: with no graded page rendered it reads \`not_rendered\`, whatever its empty-root pages show. A template of empty-root pages alone has no graded page, so its fix moves no grade: its effect is 0.`,
      `Every crawled template of empty-root pages now gets a record, \`not_rendered\` while production renders nothing. So the check that first detects it writes no \`opened\` change row: the diff writes one for a new fix only when the previous check measured the fingerprint, and a fingerprint the previous check reported indeterminate was not measured (\`diff/diff.ts\` \`measuredBefore\`). Graded templates follow the same rule.`,
      `Listed in \`DETECTORS_RUN\` (build/diff.ts): ${(['client_rendered_template', 'js_only_navigation'] as const).map((t) => `${code(t)} ${DETECTORS_RUN.includes(t) ? 'yes' : 'no'}`).join(', ')}.`,
      `Effect (grade/effects.ts \`applyFix\`): ${COUNTERFACTUALS.client_rendered_template}. The share it sets is \`SERVER_RENDERED_SHARE\`, ${SERVER_RENDERED_SHARE}.`,
      `Outcome (grade/outcomes.ts): section ${code(FIX_SECTION.client_rendered_template)}; recommendation class ${code(RENDERED_CLASS)} (\`RENDERED_CLASS\`); confidence \`confirmed\` when ${PAGES_PER_FIX_TEMPLATE} (\`PAGES_PER_FIX_TEMPLATE\`) or more of the template’s present pages were rendered, or each of them was, and \`likely\` otherwise (\`renderedConfidence\`); \`template_key\` set, which the graded phase reads to render up to that many graded pages of an open fix’s template on the next check. Title for \`/guides/{slug}\`: “${exampleTitle}”.`,
      `A template an awaiting fix names (${AWAITING_FIX_STATUSES.map(code).join(', ')}) with no graded and no empty-root page in the check gets an \`indeterminate\` record, reason \`template_absent\` (Q10, CC-32 D3), so the fix is measured again and the lifecycle's rule for an indeterminate record applies: it does not close by itself. The record is not stored as such: a fix keeps \`last_state\` \`indeterminate\`, and \`gone\` holds a page's 404 or 410 only, so the dashboard cannot tell a gone template from one not rendered. An awaiting fix whose \`template_key\` is null cannot be named by template: it gets no record and the diff leaves it as it was. The detector opens every fix with its record's template key.`,
    ]),
    '',
    '## 7. Effort and before/after',
    '',
    `Effort (${file('packets/effort.ts')} \`EFFORT_RULES\`; \`effortOf\` returns the rule of the record’s type). One line per distinct rule, with the fix types that share it:`,
    '',
    bullets(
      byRule((t) => [
        EFFORT_RULES[t].effort === null ? 'no effort' : span(json(EFFORT_RULES[t].effort)),
        EFFORT_RULES[t].rule,
      ]),
    ),
    '',
    `Before and after (${file('packets/before-after.ts')} \`BEFORE_AFTER_RULES\`). ${file('packets/before-after.same-code.test.ts')} replaces \`servedAll\` and \`allPassing\` with functions that change nothing and requires the rows to say nothing changes.`,
    '',
    bullets(
      byRule((t) => [
        `rows ${or(codes(BEFORE_AFTER_RULES[t].measures), 'none')}`,
        BEFORE_AFTER_RULES[t].rule,
      ]),
    ),
    '',
    '## 8. Stack detection',
    '',
    `The worker records, for the homepage, \`stack_signals: { cms, detected_from }\`: a CMS name from \`detectCms\` and a fixed text naming the source. The field holds no HTML and not which signal matched. \`stackOf\` (${file('build/record.ts')}) writes \`frontend: null\`, the CMS as \`backend\` unless it is \`custom\`, and \`edge\` from \`edgeOf\`. \`frameworkOf\` (${file('packets/stack.ts')}) chooses the first body: \`stack.frontend.framework\` when a later step records a front end, else \`FRAMEWORK_OF_CMS\`:`,
    '',
    table(['CMS', 'First body', 'Builders with that body'], frameworkRows()),
    '',
    ...(Object.hasOwn(FRAMEWORK_OF_CMS, 'shopify')
      ? []
      : [
          'A Shopify store is not in the table: the CMS name does not say whether the front end is a Liquid theme or Hydrogen.',
          '',
        ]),
    `A CMS outside the table, and a site with none recognised, get the generic body first; the other bodies are offered by the switch. Held by ${file('packets/stack.test.ts')}.`,
    '',
    `The signals behind those CMS names (${file('packages/engine/src/cms-detection/signatures.ts')}). One matching signal is enough for \`detectCms\` to name the CMS. Each signal, and what it also matches:`,
    '',
    bullets(signalLines()),
    '',
    'Consequence of a false match: the first body is that CMS’s where a builder has one, on a site whose front end is something else. The context and the verify block do not depend on the stack.',
    '',
    'Proposed for a later step (Q2; the worker is outside this step): an optional `stack_signals.frontend_markers: string[]` drawn from a fixed list (`next_static_path`, `next_data_script`, `shopify_theme_object`, `shopify_section_class`, `hydrogen_powered_by_header`, `wp_content_path`, `webflow_site_attribute`), written by the worker’s reader and read by `frameworkOf`.',
    '',
    '## 9. Voice (D10)',
    '',
    ...voiceSection(lab, hand),
    '',
    '## 10. Owner rulings on the packets’ text',
    '',
    'From `rulings.md` (2026-11-12), after the owner read the sample packets.',
    '',
    bullets([
      `**Ruling 1: the verify block must be readable.** The layers of §4. Engine: each structure builder’s test has a case titled “shows … with a command to read, and what it prints today and after” (for one, ${held('packets/by-type/canonical-mismatch.test.ts', 'shows the canonical with a command to read, and what it prints today and after')}); the content builders share ${held('packets/test-support/content.ts', 'prints the evidence: without it before the fix, as `today` says, and with it after, as `after` says')}; ${held('packets/edge-rule-blocks-crawler.test.ts', 'the readable command prints the status: the audit’s today, 200 once served')}; ${held('packets/client-rendered-template.test.ts', 'the readable command prints a rough count: not below the audit’s today, higher by the gained words once fixed')}. Web: ${held('apps/web/lib/v2/view/fix.test.ts', 'shows “See it” above “Exact check” in each body’s block, from that body')}; ${held('apps/web/lib/v2/view/segment/fixes.test.ts', 'shows “See it” above “Exact check” for a packet with a readable command, from its own body')}; ${held('apps/web/__tests__/v2/fix.test.tsx', 'shows “See it” with what it prints today and after the fix, then “Exact check”')}. Round 3 found readable commands that print nothing on common markup: the open limits of §5.`,
      `**Ruling 2: a count of 1 takes the singular.** Structure: \`expectOwnWords\` (${file('packets/test-support/structure.ts')}) is applied by \`packetOf\`, through which the structure tests build their packets, and to the packets of ${held('packets/structure-fuzz.test.ts', 'write a packet the contract accepts for every record a detector reports as detected')}; plus ${held('packets/by-type/redirect-chain.test.ts', 'takes the singular at one redirect and at one linking page')} and ${held('packets/by-type/generic-anchor-text.test.ts', 'takes the singular at one link')}. Content: ${held('packets/test-support/content.ts', 'says 1 of anything in the singular')}. Edge and rendered: ${held('packets/edge-rule-blocks-crawler.test.ts', 'says 1 of anything in the singular: each count at 1 and at 2 (property)')}; ${held('packets/client-rendered-template.test.ts', 'says 1 of anything in the singular: each count at 1 and at 2 (property)')}. The fix page’s own words: ${file('apps/web/__tests__/v2/fix-words.test.tsx')}.`,
      `**Ruling 3: no internal identifier in rendered text.** A cause and a check are said in words (the lists at the end of §4). Structure: \`expectOwnWords\`, which looks outside code spans. Content: the suite “no identifier of ours in the text” in ${file('packets/test-support/content.ts')}. Edge: ${held('packets/edge-rule-blocks-crawler.test.ts', 'says the cause %s in words')}. Rendered: ${held('packets/client-rendered-template.test.ts', 'shows no identifier of ours: every value is said in words')}. The fix page’s own words: ${file('apps/web/__tests__/v2/fix-words.test.tsx')}.`,
      '**Ruling 4** (timestamps in the step’s `status.md`) concerns the notes, not the code.',
    ]),
    '',
    '## 11. Review record',
    '',
    'Tier A: a technical-SEO, a security and a correctness reviewer, each on a frozen commit. Scores out of 10, as the reports in the step’s `reviews/` give them.',
    '',
    bullets(
      REVIEW_ROUNDS.map(
        (r) =>
          `Round ${r.round}, frozen \`${r.frozen}\`: technical SEO ${score(r.seo)}, security ${score(r.security)}, correctness ${score(r.correctness)}.`,
      ),
    ),
    '',
    'Round 3’s technical-SEO report has no blocking finding; what it left open is under the types in §5 and in ruling 2 above.',
    '',
    `The ${MUTATIONS.length} mutations the brief requires, as round 2’s correctness review ran them at \`07987f9f\`, each on a harness first proven live with an unconditional throw (the step’s \`r2-correctness/mutations.md\`). They were not run again for this document; rendering it checks that each file exists and that each test title is still in its file.`,
    '',
    bullets(mutationLines()),
    '',
    '## 12. Questions and the owner’s answers',
    '',
    'Open, each with the recommendation that was acted on:',
    '',
    bullets([
      '**Q2.** The worker records a CMS name and no front-end marker, so Next.js, Liquid and Hydrogen are not told apart. Acted on: `stack.frontend` stays null and the first body follows the CMS (§8). Proposed: the additive worker field of §8.',
      '**Q3.** `js_only_navigation` needs the rendered side’s links, which the render step does not keep. Acted on: the type stays unopened with its reason in the registry. Proposed: a CC-14 follow-up that keeps the rendered same-site link targets.',
      '**Q4.** `effort` is a label field, so a fix first found before this step keeps `effort: null` until it resolves and reopens. Acted on: the diff is left alone. Proposed, if such fixes exist in production: take `effort` in the diff when the stored one is null.',
      '**Q5.** A route that serves an empty root is thin, not graded and not rendered, so a pure-shell site gets no `client_rendered_template` fix, and rendering thin pages alone would give one an effect of 0. Acted on: the fix opens on what the render step measured (§6). For the owner: whether the graded population should change is an OPERATING-RULES §5 question.',
      '**Pagination and D3.** The near-duplicate half of the `duplicate_pagination` exact check can exit 0 on an unfixed site (§5, its open limit). Acted on: kept, disclosed in `expect`, here and in the PR text. For the owner: accept it as an exception to D3, or have the packet carry no exact check for that condition.',
      `**Q9.** Edits outside the allowed paths: \`packets_not_written\` in ${file('build/summaries.ts')}; the exports \`PACKETS\` and \`frameworkOf\` in ${file('pipeline-surface.ts')}; the locked-fix scan in ${file('tests/visual/production.spec.ts')}; and ${file('clean-text.ts')} outside \`packets/\`. Acted on: kept. The owner approved them (\`rulings-3.md\`).`,
      '**Q10.** An open client-rendered fix can go stale: a template that loses its graded pages gets no record, the diff reads that as absent, and the fix stays open on old evidence. Not fixed here (the diff is outside this step). Proposed: the detector emits `indeterminate` for a template an open fix names. The owner agreed and logged it as a follow-up (`rulings-3.md`).',
    ]),
    '',
    'Approved by the owner:',
    '',
    bullets([
      `**Q1.** One added argument at the call of \`detectorOutcomes\` in ${file('build/grade.ts')}, the rendered detector called beside the others there, and one line in \`DETECTORS_RUN\` (${file('build/diff.ts')}). Approved as acted on (\`rulings.md\`).`,
      `**Q6.** Web files outside the brief’s list, edited where the chosen body, the prompt and the not-written reason are produced: ${files(['apps/web/lib/v2/view/segment/fixes.ts', 'apps/web/lib/v2/account/fixes.ts', 'apps/web/lib/v2/view/no-packet.ts'])}. Approved as acted on (\`rulings.md\`).`,
      '**Q7.** The fix title holds crawled text and is the first line of the copied prompt: `titleOf` cleans it and bounds it at `MAX_TITLE_CHARS`. Approved as acted on (`rulings.md`).',
      '**Q8.** The required, nullable `verify.see`: the owner-approved non-additive change of §4 (`rulings-2.md`).',
    ]),
  ].join('\n')}\n`;
}

/** The render as the repository's prettier leaves it, which is what the file holds. */
export async function formattedPacketSpec(): Promise<string> {
  const path = fileURLToPath(SPEC_URL);
  const config = await resolveConfig(path);
  return format(renderPacketSpec(), { ...config, filepath: path });
}
