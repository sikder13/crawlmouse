/**
 * The fixes block at the foot of a segment: the section's fixes among the audit's free three, each
 * with its packet, and the rest as Pro rows. The free three are the audit's, not the section's
 * (`freeFixes`, the rule the Result page and the fix page use too), so the sections' open counts
 * add up to the overview's.
 */
import {
  RecommendationClassSchema,
  type Check,
  type Fix,
  type FixSection,
  type RecommendationClass,
} from '@crawlmouse/types/v2';
import { fixesAsOf } from '../../fixtures';
import { listOf } from '../../format';
import { oneLine } from '../../packet-text';
import { numberWord, plural } from '../../words';
import { effectHeadline } from '../effect-headline';
import { openFixes, type FixPlan } from '../free-fixes';
import { noPacketLine } from '../no-packet';
import { noPacketReason } from '../packet-reason';
import type { ViewDataset } from '../../fixtures';

/** A fix's packet; the contract names the schema, not the type. */
export type FixPacket = NonNullable<Fix['packet']>;
/** A packet's framework. */
export type PacketFramework = FixPacket['framework'];
/** A packet as written for one framework: the packet's own body, or one of `packets`. */
export type PacketBody = FixPacket['packets'][number];

/** The four recommendation classes as a reader sees them (the CC-23 brief's wording). */
export const RECOMMENDATION_LABELS: Record<RecommendationClass, string> = {
  confirmed_defect: 'confirmed defect',
  documented_requirement: 'documented platform requirement',
  best_practice: 'supported best practice',
  experimental: 'experimental hypothesis',
};

export interface RecommendationView {
  cls: RecommendationClass;
  label: string;
}

export interface OpenFixView {
  id: string;
  number: number;
  title: string;
  /** The estimated points, as a number with its sign ("+24"); the screen sets it in the data face. */
  points: string;
  unit: string;
  effort: string | null;
  recommendation: RecommendationView;
  /** What the packet says about the problem; empty when the fix has no packet. */
  paragraph: string[];
  /**
   * The steps, what to keep, and the check we run afterwards, as the packet block shows them, from
   * the body written for the packet's own framework. Null when the fix has no packet: `handoff` and
   * `prompt` are then null too, and the screen says `notWritten` in their place.
   */
  packet: string | null;
  handoff: string | null;
  /** The whole packet as plain text, for "Copy as a prompt". */
  prompt: string | null;
  /** Why the fix has no packet, as a sentence; null exactly when it has one. */
  notWritten: string | null;
}

export interface ProFixView {
  key: string;
  title: string;
  scope: string | null;
  points: string;
  /** The classes of the fixes the row stands for, with how many of each, in the contract's order. */
  recommendations: (RecommendationView & { count: number })[];
  count: number;
}

export interface SectionFixesView {
  /** "1 open · 7 on Pro", or "nothing to fix". */
  summary: string;
  open: OpenFixView[];
  pro: ProFixView[];
  proCount: number;
  /** The audit's free fixes that live in other sections, in rank order. */
  openElsewhere: { title: string; section: FixSection }[];
}

/** What each section's fixes are called in a grouped row ("5 more structure fixes"). */
const SECTION_NOUN: Record<FixSection, string> = {
  crawler_access: 'crawler access',
  without_js: 'JavaScript',
  structure: 'structure',
  content: 'content',
};

/** How many Pro fixes are named; beyond this, all but the first two are grouped into one row. */
const NAMED_PRO = 3;

/** A packet's first context line names the site and audit (the page's crumb already does). */
const SITE_LINE = /^Site: /;

export const recommendation = (f: Pick<Fix, 'recommendation_class'>): RecommendationView => ({
  cls: f.recommendation_class,
  label: RECOMMENDATION_LABELS[f.recommendation_class],
});

export function effortText(f: Pick<Fix, 'effort'>): string | null {
  const e = f.effort;
  if (!e) return null;
  return e.kind === 'minutes'
    ? `about ${e.minutes} ${plural(e.minutes, 'minute', 'minutes')}`
    : `${numberWord(e.templates)} ${plural(e.templates, 'template', 'templates')}, ${numberWord(e.deploys)} ${plural(e.deploys, 'deploy', 'deploys')}`;
}

/** "+1 Technical SEO; AI effect estimated after fixes 1 and 2", from the fix's own numbers. */
function proPoints(f: Fix, all: readonly Fix[]): string {
  const parts: string[] = [];
  if (f.effect.ai_readability) parts.push(`+${f.effect.ai_readability} AI readability`);
  if (f.effect.technical_seo) parts.push(`+${f.effect.technical_seo} Technical SEO`);
  const head = parts.join(', ') || 'no estimated effect';
  const waits = f.effect.ai_readability_pending_on
    .map((fp) => all.find((x) => x.fingerprint === fp)?.number)
    .filter((n): n is number => n !== undefined);
  return f.effect.ai_readability === null && waits.length
    ? `${head}; AI effect estimated after ${plural(waits.length, 'fix', 'fixes')} ${listOf(waits.map(String))}`
    : head;
}

/** How many of `fixes` carry each class, in the contract's order of classes. */
function tally(fixes: readonly Fix[]): ProFixView['recommendations'] {
  return RecommendationClassSchema.options
    .map((cls) => ({
      cls,
      label: RECOMMENDATION_LABELS[cls],
      count: fixes.filter((f) => f.recommendation_class === cls).length,
    }))
    .filter((r) => r.count > 0);
}

/**
 * A grouped row's effect: both grades' points summed, and how many fixes have an AI readability
 * effect not yet estimated, so no part of the group's effect is left out.
 */
export function groupPoints(fixes: readonly Fix[]): string {
  const seo = fixes.reduce((n, f) => n + (f.effect.technical_seo ?? 0), 0);
  const ai = fixes.reduce((n, f) => n + (f.effect.ai_readability ?? 0), 0);
  const pending = fixes.filter((f) => f.effect.ai_readability === null).length;
  const seoPending = fixes.filter((f) => f.effect.technical_seo === null).length;
  const seoShown = seoPending < fixes.length;
  // an AI effect estimated at 0 is still an estimate, shown when no Technical SEO points are
  const aiShown = ai !== 0 || (!seoShown && pending < fixes.length);
  const parts = [
    seoShown ? `+${seo} Technical SEO` : null,
    aiShown ? `+${ai} AI readability` : null,
  ].filter(Boolean);
  const waits = [
    seoPending ? `Technical SEO effect not estimated for ${seoPending}` : null,
    pending ? `AI effect not yet estimated for ${pending}` : null,
  ].filter(Boolean);
  const head = parts.length ? `${parts.join(', ')} together` : 'no estimated effect';
  return `${head}${waits.length ? `; ${waits.join('; ')}` : ''}`;
}

/**
 * A fix's estimated effect as the open fix and the fix page head it, by `effectHeadline`'s rule: its
 * points with "estimated" in the unit (FACTS A5), or a dash and why its AI effect waits.
 */
export function effectOf(
  f: Pick<Fix, 'effect' | 'section'>,
  siteFixes: readonly Pick<Fix, 'fingerprint' | 'number'>[],
): { points: string; unit: string } {
  const h = effectHeadline(f, siteFixes);
  if (h.kind === 'ai') return { points: `+${h.points}`, unit: 'AI readability, estimated' };
  if (h.kind === 'seo') return { points: `+${h.points}`, unit: 'Technical SEO, estimated' };
  return h.kind === 'waiting'
    ? { points: '—', unit: h.sentence }
    : { points: '—', unit: 'Technical SEO, not estimated' };
}

/**
 * The bodies a packet holds, its own framework's first, then `packets` in their order, each string
 * on one line (`oneLine`). `frameworks` is not read: a framework it lists without a body is not in
 * this list, which is what the fix page's switch and the packet route offer.
 */
export function packetBodies(p: FixPacket): PacketBody[] {
  const own: PacketBody = {
    framework: p.framework,
    context: p.context,
    change: p.change,
    keep: p.keep,
    verify: p.verify,
  };
  return [own, ...p.packets].map(cleanBody);
}

/** `b` with each of its strings on one line. */
const cleanBody = (b: PacketBody): PacketBody => ({
  framework: b.framework,
  context: b.context.map(oneLine),
  change: b.change.map(oneLine),
  keep: b.keep.map(oneLine),
  verify: {
    command: oneLine(b.verify.command),
    expect: oneLine(b.verify.expect),
    ua: b.verify.ua,
    see: b.verify.see && {
      command: oneLine(b.verify.see.command),
      today: oneLine(b.verify.see.today),
      after: oneLine(b.verify.see.after),
    },
  },
});

/** The packet's problem lines: its context without the line naming the site and audit. */
export const packetParagraph = (b: Pick<PacketBody, 'context'>) =>
  b.context.filter((l) => !SITE_LINE.test(l));

/** The verify lines of the segment's packet block and of the prompt. */
const verifyLines = (b: Pick<PacketBody, 'verify'>) => [
  'Verify (we run this after you mark done):',
  `  ${b.verify.command}`,
  `  → expect ${b.verify.expect}`,
];

/** The label a prompt's first line gives the fix's title under. */
export const PROMPT_TITLE_LABEL = 'The audit’s title for this fix:';

/**
 * The first line of a prompt: the title on one line, in double quotes, with each double quote in it
 * written as an apostrophe so the title cannot end the quotation it is in.
 */
export const promptTitle = (title: string): string =>
  `${PROMPT_TITLE_LABEL} "${oneLine(title).replaceAll('"', "'")}"`;

/**
 * One body of a packet as plain text, for "Copy as a prompt": the fix page, the segment and the
 * packet route copy this, so the same fix is handed over in the same words wherever it is copied
 * from. The title and each string of the body are put on one line here (`oneLine`), so the prompt
 * has one line per string, whatever a stored string holds (fixes.property.test.ts).
 *
 * A fix's title holds text a crawled site chose (a URL, a template key), and the first line of a
 * prompt is where a coding tool looks for what it is asked to do. So the title is given as a quoted
 * string under a label of ours (`promptTitle`), not as a line of its own.
 */
export function packetPrompt(f: Pick<Fix, 'title'>, body: PacketBody): string {
  const b = cleanBody(body);
  return [
    promptTitle(f.title),
    '',
    ...b.context,
    '',
    'Change:',
    ...b.change,
    ...(b.keep.length ? ['', 'Keep:', ...b.keep] : []),
    '',
    ...verifyLines(b),
  ].join('\n');
}

export function openFix(f: Fix, siteFixes: readonly Fix[]): OpenFixView {
  const { points, unit } = effectOf(f, siteFixes);
  const head = {
    id: f.id,
    number: f.number,
    title: f.title,
    points,
    unit,
    effort: effortText(f),
    recommendation: recommendation(f),
  };
  if (!f.packet) {
    return {
      ...head,
      paragraph: [],
      packet: null,
      handoff: null,
      prompt: null,
      notWritten: noPacketLine(noPacketReason(f.type)),
    };
  }
  const own = packetBodies(f.packet)[0]!;
  const block = [
    ...own.change,
    ...(own.keep.length ? ['', ...own.keep] : []),
    '',
    ...verifyLines(own),
  ];
  const check = own.verify.ua ? 'request' : 'check';
  return {
    ...head,
    paragraph: packetParagraph(own),
    packet: block.join('\n'),
    handoff: `Handing this to your coding tool or your developer? The packet contains the steps above and the ${check} we’ll run afterwards to confirm it worked.`,
    prompt: packetPrompt(f, own),
    notWritten: null,
  };
}

export function sectionFixes(
  d: ViewDataset,
  check: Check,
  section: FixSection,
  plan: FixPlan = 'free',
): SectionFixesView {
  const all = fixesAsOf(d, check);
  const free = openFixes(d, check, plan);
  const here = all.filter((f) => f.section === section);
  const isFree = (f: Fix) => free.some((x) => x.id === f.id);
  const open = here.filter(isFree);
  const pro = here.filter((f) => !isFree(f));
  // A pending effect names fixes of this site, by number; another site's numbers are its own.
  const siteFixes = d.fixes.filter((x) => x.site_id === check.site_id);
  const row = (f: Fix): ProFixView => ({
    key: f.id,
    title: f.title,
    scope: f.detail,
    points: proPoints(f, siteFixes),
    recommendations: tally([f]),
    count: 1,
  });
  const named = pro.length <= NAMED_PRO ? pro : pro.slice(0, NAMED_PRO - 1);
  const rest = pro.slice(named.length);
  const rows = named.map(row);
  if (rest.length) {
    rows.push({
      key: 'rest',
      title: `${rest.length} more ${SECTION_NOUN[section]} fixes`,
      scope: listOf(rest.map((f) => f.title.replace(/^./u, (c) => c.toLowerCase()))),
      points: groupPoints(rest),
      recommendations: tally(rest),
      count: rest.length,
    });
  }
  return {
    summary: here.length
      ? [`${open.length} open`, pro.length ? `${pro.length} on Pro` : null]
          .filter(Boolean)
          .join(' · ')
      : 'nothing to fix',
    open: open.map((f) => openFix(f, siteFixes)),
    pro: rows,
    proCount: pro.length,
    openElsewhere: free
      .filter((f) => f.section !== section)
      .map((f) => ({ title: f.title, section: f.section })),
  };
}
