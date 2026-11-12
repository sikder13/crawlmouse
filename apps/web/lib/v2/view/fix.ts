/**
 * The fix page (Final-Fix): one fix of one audit, its estimated effect and, when the reader's plan
 * opens it, the packet: one body per framework the packet was written for, the packet's own first.
 * Which plan opens which fix is the free-fix rule (free-fixes.ts); the contract stores no plan
 * (fix.ts, `packet`). A locked fix's view is built without reading its packet at all, so no part of
 * it, `packets` included, can reach the page: everything but the open branch takes the fix as
 * `withoutPacket` copies it, and fix.test.ts makes the field throw when read.
 */
import { frameworkOf } from '@crawlmouse/engine/v2/pipeline';
import { RECHECK_MINUTES } from '../recheck';
import type { Check, CrawlerResult, Fix } from '@crawlmouse/types/v2';
import { instant } from '@crawlmouse/types/v2';
import { findCheck, fixesAsOf, siteOf } from '../fixtures';
import { dayTimeUtc, listOf, percent } from '../format';
import { count, numberWord, plural } from '../words';
import { freeFixes, type FixPlan } from './free-fixes';
import { noPacketLine } from './no-packet';
import { noPacketReason } from './packet-reason';
import { keptUntilOf, points } from './result';
import {
  effectOf,
  effortText,
  packetBodies,
  packetParagraph,
  packetPrompt,
  recommendation,
  type PacketBody,
  type PacketFramework,
  type RecommendationView,
} from './segment/fixes';
import {
  NO_HREFS,
  SEGMENT_KEYS,
  SEGMENTS,
  type SegmentHrefs,
  type SegmentKey,
  type SegmentLink,
} from './segment/frame';
import type { ViewDataset } from '../fixtures';

export type { FixPlan, PacketFramework };

export interface FixHrefs extends SegmentHrefs {
  /** A fix's own page, by id. Omitted, a fix links nowhere yet ("#"). */
  fix?: (fixId: string) => string;
}

export interface FixOptions {
  /** The reader's plan: Free opens the free fixes (free-fixes.ts), Pro opens every live fix. */
  plan?: FixPlan;
  /** Show a since-kept check as it was at its finish, as the Result preview does. */
  asFirstSeen?: boolean;
  hrefs?: FixHrefs;
  /**
   * Whether the page can mark a fix done and re-check, which the "When you've shipped it" card
   * describes. The previews show the card; a page with no such action passes false and has none.
   */
  rerun?: boolean;
}

export interface FixFrame {
  domain: string;
  /** The crumb's first link and the Overview tab. */
  overview: string;
  /** The section the fix belongs to: the crumb's second link, the current tab, the back link. */
  section: { title: string; href: string };
  /** "Fix 2 of 14", or "Fix 1, resolved". */
  position: string;
  keptUntil: string | null;
  keepHref: string;
  tabs: (SegmentLink & { current: boolean })[];
  back: SegmentLink;
  /** The next live fix in order, with its effect; null on a resolved fix. */
  next: SegmentLink | null;
}

export interface FixTile {
  label: string;
  value: string;
  note: null;
}

export interface FixHead {
  title: string;
  points: string;
  unit: string;
  recommendation: RecommendationView;
  /** What the packet says is wrong; a locked fix has none to say it from. */
  lede: string[];
  tiles: FixTile[];
}

export interface BeforeAfterView {
  rows: { label: string; today: string; after: string }[];
  /** What a starred "after" waits on, when another fix accounts for the rest. */
  footnote: string | null;
}

export interface FixKeep {
  title: string;
  sub: string;
  /** The bar's button is the page's orange element when no packet is open to copy. */
  primary: boolean;
}

interface FixBase {
  frame: FixFrame;
  head: FixHead;
  beforeAfter: BeforeAfterView | null;
  keep: FixKeep | null;
}

/** One choice of the framework switch: a framework the packet holds a body for. */
export interface FrameworkOption {
  key: PacketFramework;
  label: string;
}

/** A packet as written for one framework. */
export interface PacketBodyView extends FrameworkOption {
  /** Which stack this body is written for, beside the stack the check detected. */
  stack: string;
  /** The body as the page's block shows it, under its four headings. */
  block: string;
  /** The body as plain text, for "Copy as a prompt" (the segment copies the same text). */
  prompt: string;
}

export interface OpenFixPage extends FixBase {
  kind: 'open';
  /** Null when the fix has no packet (the contract allows it); `notWritten` then says why. */
  packet: {
    /** A body per framework the packet was written for, the packet's own first; never empty. */
    bodies: PacketBodyView[];
    /** The file name "Download as .md" saves. */
    download: string;
  } | null;
  /** Why the fix has no packet, as a sentence; null exactly when it has one. */
  notWritten: string | null;
  /** The framework switch, one option per body in their order; null for a packet with one body. */
  switcher: { heading: string; detected: string; options: FrameworkOption[] } | null;
  /**
   * What happens once the fix ships, with the ask that opens the keep bar; null on a kept audit,
   * whose account action the preview does not have, and on a page that cannot re-check
   * (`FixOptions.rerun`).
   */
  shipped: { heading: string; body: string; action: SegmentLink } | null;
}

export interface LockedFixPage extends FixBase {
  kind: 'locked';
  /** The ask opens the keep bar; with no keep bar (a kept audit) there is none. */
  wall: { heading: string; body: string; action: SegmentLink | null };
}

export interface ResolvedFixPage extends FixBase {
  kind: 'resolved';
  resolved: string;
}

export type FixView = OpenFixPage | LockedFixPage | ResolvedFixPage;

/** FACTS I12: the stacks a packet is written for, as the switch names them. */
export const FRAMEWORK_LABELS: Record<PacketFramework, string> = {
  nextjs: 'Next.js',
  shopify_liquid: 'Shopify (Liquid)',
  shopify_hydrogen: 'Shopify (Hydrogen)',
  wordpress: 'WordPress',
  webflow: 'Webflow',
  generic: 'Other',
};

type CmsName = NonNullable<NonNullable<Check['stack']>['backend']>['cms'];

const CMS_LABELS: Record<CmsName, string> = {
  shopify: 'Shopify',
  wordpress: 'WordPress',
  webflow: 'Webflow',
  wix: 'Wix',
  squarespace: 'Squarespace',
  framer: 'Framer',
  ghost: 'Ghost',
  custom: 'a custom backend',
};

/** The segment each section's fixes are listed on. */
const SEGMENT_OF = Object.fromEntries(
  SEGMENT_KEYS.filter((k) => SEGMENTS[k].section).map((k) => [SEGMENTS[k].section!, k]),
) as Record<Fix['section'], SegmentKey>;

/** A crawler that gets in: let in, whether or not it reads the page's text. */
const getsIn = (c: CrawlerResult) => c.verdict === 'allowed' || c.verdict === 'allowed_thin';

const isAi = (c: CrawlerResult) => c.group !== 'search_engine';

/** "Server-render the product template." — the locked heading ends its sentence. */
const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

const bound = (b: Fix['before_after'][number]['after_bound']) =>
  b === 'approx' ? '≈ ' : b === 'at_least' ? '≥ ' : '';

function headOf(f: Omit<Fix, 'packet'>, lede: string[], siteFixes: readonly Fix[]): FixHead {
  const textShare = f.before_after.find((r) => r.measure === 'text_share');
  const effort = effortText(f);
  const tiles: FixTile[] = [];
  if (f.affected_pages > 0) {
    tiles.push({ label: 'Pages affected', value: count(f.affected_pages), note: null });
  }
  if (textShare && typeof textShare.today === 'number' && typeof textShare.after === 'number') {
    tiles.push(
      { label: 'Text today', value: `${percent(textShare.today)}%`, note: null },
      {
        label: 'Text after, estimated',
        value: `${bound(textShare.after_bound)}${percent(textShare.after)}%`,
        note: null,
      },
    );
  }
  if (effort) tiles.push({ label: 'Effort', value: effort, note: null });
  return {
    title: sentence(f.title),
    ...effectOf(f, siteFixes),
    recommendation: recommendation(f),
    lede,
    tiles,
  };
}

function beforeAfterOf(
  check: Check,
  f: Omit<Fix, 'packet'>,
  live: readonly Fix[],
): BeforeAfterView | null {
  const rows = f.before_after.filter((r) => r.measure !== 'text_share');
  if (!rows.length) return null;
  const ai = check.crawlers.filter(isAi);
  const others = live.filter((x) => x.id !== f.id);
  // The AI crawlers kept out today, and the other fixes that are about letting them in.
  const out = ai.filter((c) => !getsIn(c)).map((c) => c.ua);
  const lettingIn = others.filter((x) => x.crawler_uas.some((ua) => out.includes(ua)));
  const covered = out.every((ua) => lettingIn.some((x) => x.crawler_uas.includes(ua)));
  let footnote: string | null = null;
  const view = rows.map((r) => {
    switch (r.measure) {
      case 'crawlers_reading_text': {
        const after = Number(r.after);
        const waits =
          after < ai.length && out.length && covered && after + out.length === ai.length;
        if (waits) {
          const numbers = lettingIn.map((x) => String(x.number));
          const sections = [...new Set(lettingIn.map((x) => SEGMENTS[SEGMENT_OF[x.section]].tab))];
          footnote = `* ${ai.length} of ${ai.length} once ${plural(numbers.length, 'fix', 'fixes')} ${listOf(numbers)} in ${listOf(sections)} ${plural(numbers.length, 'is', 'are')} also fixed.`;
        }
        return {
          label: 'AI crawlers that read the text',
          today: `${count(Number(r.today))} of ${ai.length}`,
          after: `${bound(r.after_bound)}${count(after)} of ${ai.length}${waits ? '*' : ''}`,
        };
      }
      case 'quotable_opening': {
        const yes = (v: number | boolean) => (v ? 'yes' : 'no');
        const content = others.some((x) => x.section === 'content');
        return {
          label: 'Quotable opening',
          today: yes(r.today),
          after: !r.after && content ? 'no, until the Content fixes' : yes(r.after),
        };
      }
      case 'words_without_js':
        return {
          label: 'Words without JavaScript',
          today: count(Number(r.today)),
          after: `${bound(r.after_bound)}${count(Number(r.after))}`,
        };
      case 'text_share':
        throw new Error('unreachable: the text share is shown in the tiles');
    }
  });
  return { rows: view, footnote };
}

/** "Next.js 14, pages router, Shopify as the product backend", from the check's detected stack. */
function stackOf(check: Check): string | null {
  const s = check.stack;
  const front = s?.frontend
    ? [
        [s.frontend.name, s.frontend.version].filter(Boolean).join(' '),
        s.frontend.router ? `${s.frontend.router} router` : null,
      ]
        .filter(Boolean)
        .join(', ')
    : null;
  const back = s?.backend
    ? front
      ? // Shopify behind a separate front end serves the products (FACTS: "the product backend").
        `${CMS_LABELS[s.backend.cms]} as the ${s.backend.cms === 'shopify' ? 'product ' : ''}backend`
      : CMS_LABELS[s.backend.cms]
    : null;
  return [front, back].filter(Boolean).join(', ') || null;
}

/**
 * Whether `framework` is the one the engine writes a packet for first on this check's stack
 * (`frameworkOf`, packages/engine/src/v2/packets/stack.ts): the detected front end's framework, or
 * the framework the CMS itself is. The engine's own function, so the page and the packet agree.
 */
const detects = (check: Check, framework: PacketFramework): boolean =>
  framework !== 'generic' && check.stack !== null && frameworkOf(check.stack) === framework;

/** "The audit detected Next.js from the asset paths and Shopify from the product API calls." */
function detectedOf(check: Check): string {
  const s = check.stack;
  const parts = [
    s?.frontend ? `${s.frontend.name} from ${s.frontend.detected_from}` : null,
    s?.backend ? `${CMS_LABELS[s.backend.cms]} from ${s.backend.detected_from}` : null,
  ].filter((x): x is string => x !== null);
  return parts.length
    ? `The audit detected ${listOf(parts)}.`
    : 'The audit did not detect this site’s stack.';
}

/** What the switch card is headed with, which a packet's sentence names when it points there. */
const CHOOSE = 'Choose your stack';

/**
 * Which stack a body is written for. The packet's own body (`own`) is the one the engine chose for
 * the check's stack, so a generic one says what the audit detected and why no named stack came
 * first; `switchable` is whether the page has a switch to point to.
 */
function writtenFor(
  check: Check,
  framework: PacketFramework,
  { own, switchable }: { own: boolean; switchable: boolean },
): string {
  const stack = stackOf(check);
  if (framework !== 'generic') {
    return detects(check, framework) && stack
      ? `Written for your stack as detected: ${stack}.`
      : `Written for ${FRAMEWORK_LABELS[framework]}${stack ? `; the audit detected ${stack}` : ''}.`;
  }
  if (!own) return 'Written for any stack.';
  const detected = check.stack ? frameworkOf(check.stack) : null;
  if (stack && detected !== null && detected !== 'generic') {
    return `Written for any stack; the audit detected ${stack} and has no steps specific to it for this fix.`;
  }
  const choose = switchable ? ` If yours is listed under “${CHOOSE}”, choose it.` : '';
  if (!stack) return `Written for any stack: the audit did not detect yours.${choose}`;
  return check.stack?.frontend
    ? `Written for any stack; the audit detected ${stack}, which has no steps of its own.${choose}`
    : `Written for any stack: the audit detected ${stack}, not which front end the site runs.${choose}`;
}

/** One body under its four headings, with the check's crawler and what we run afterwards. */
function packetBlock(check: Check, f: Pick<Fix, 'affected_pages'>, b: PacketBody): string {
  const indent = (lines: readonly string[]) => lines.map((l) => `  ${l}`);
  // `verify.ua` is set when the command requests as a crawler (the contract's field); the command's
  // own first word is not read, since a command can start with `test "$(curl …`.
  const asCrawler = b.verify.ua !== null;
  const crawler = asCrawler ? check.crawlers.find((c) => c.ua === b.verify.ua) : undefined;
  const got = crawler ? (crawler.status === null ? 'robots.txt' : String(crawler.status)) : null;
  const verify = [
    b.verify.command,
    `  → expect ${b.verify.expect}`,
    // FACTS D1: a request as a crawler is our tagged request's twin, not the same request.
    ...(asCrawler
      ? [
          '# we run the same request with a tagged user agent; your result and ours can differ only if a rule matches the exact string',
        ]
      : []),
    ...(crawler ? [`Requests as ${crawler.ua}, which gets ${got} today.`] : []),
    f.affected_pages > 1
      ? `We run this on all ${count(f.affected_pages)} pages when you mark the fix done.`
      : 'We run this when you mark the fix done.',
  ];
  return [
    'Context',
    ...indent(b.context),
    '',
    'Change',
    ...indent(b.change),
    ...(b.keep.length ? ['', 'Keep', ...indent(b.keep)] : []),
    '',
    'Verify',
    ...indent(verify),
  ].join('\n');
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** The ask that stands where a locked fix's packet would be (DESIGN-LOCK: hold the cure). */
function lockedPart(frame: FixFrame, free: number): Pick<LockedFixPage, 'kind' | 'wall'> {
  const which = `Free opens the first ${numberWord(free)} ${plural(free, 'fix', 'fixes')} in this audit’s order.`;
  // An audit nobody has kept has the keep bar to ask with; a kept one has no ask on this page.
  const unkept = frame.keptUntil !== null;
  return {
    kind: 'locked',
    wall: {
      heading: 'The packet',
      body: `The steps for this fix, what to keep, and the check we run afterwards are on Pro. ${which} ${unkept ? 'Keeping this audit starts 14 days of Pro, with every fix open.' : 'Pro opens every fix, with its packet.'}`,
      action: unkept ? { label: 'See this fix with Pro', href: frame.keepHref } : null,
    },
  };
}

/** The fix without its packet, copied field by field so the packet is never read. */
function withoutPacket(f: Fix): Omit<Fix, 'packet'> {
  const keys = Object.keys(f).filter((k) => k !== 'packet') as (keyof Omit<Fix, 'packet'>)[];
  return Object.fromEntries(keys.map((k) => [k, f[k]])) as Omit<Fix, 'packet'>;
}

export function fixView(
  d: ViewDataset,
  checkId: string,
  fixId: string,
  { plan = 'free', asFirstSeen = false, hrefs = NO_HREFS, rerun = true }: FixOptions = {},
): FixView {
  const check = findCheck(d, checkId);
  const fix = d.fixes.find((x) => x.id === fixId);
  if (!fix) throw new Error(`No fix ${fixId}`);
  if (fix.site_id !== check.site_id) {
    throw new Error(`Fix ${fixId} belongs to another site than check ${checkId}`);
  }
  if (instant(findCheck(d, fix.first_seen_check_id).queued_at) > instant(check.queued_at)) {
    throw new Error(`Fix ${fixId} was not seen yet at check ${checkId}`);
  }
  const live = fixesAsOf(d, check);
  // a pending AI effect names fixes of this site by fingerprint, resolved or not
  const siteFixes = d.fixes.filter((x) => x.site_id === check.site_id);
  const at = live.findIndex((x) => x.id === fixId);
  const bare = withoutPacket(fix);
  const segment = SEGMENT_OF[bare.section];
  const keptUntil = keptUntilOf(d, check, asFirstSeen);
  const keepHref = keptUntil === null ? '#' : '#keep';
  const following = at >= 0 ? live[at + 1] : undefined;
  const frame: FixFrame = {
    domain: siteOf(d, check).host,
    overview: hrefs.overview,
    section: { title: SEGMENTS[segment].title, href: hrefs.segment(segment) },
    // The fix's own number, and where it stands in the audit's order when that differs from it.
    position:
      at < 0
        ? `Fix ${bare.number}, resolved`
        : bare.number === at + 1
          ? `Fix ${bare.number} of ${live.length}`
          : `Fix ${bare.number} · ${at + 1} of ${live.length}`,
    keptUntil: keptUntil === null ? null : dayTimeUtc(keptUntil),
    keepHref,
    tabs: [
      { label: 'Overview', href: hrefs.overview, current: false },
      ...SEGMENT_KEYS.map((k) => ({
        label: SEGMENTS[k].tab,
        href: hrefs.segment(k),
        current: k === segment,
      })),
    ],
    back: { label: `Back: ${SEGMENTS[segment].backName}`, href: hrefs.segment(segment) },
    next:
      at < 0
        ? null
        : following
          ? {
              label: `Next fix: ${following.title} · ${points(following, siteFixes)}`,
              href: hrefs.fix?.(following.id) ?? '#',
            }
          : { label: 'Back to overview', href: hrefs.overview },
  };

  if (at < 0) {
    const verified = d.fix_events
      .filter((e) => e.fix_id === fixId && e.kind === 'verified')
      .filter((e) => instant(e.at) <= instant(check.finished_at!))
      .at(-1);
    if (!verified) throw new Error(`Fix ${fixId} is neither live nor resolved at ${checkId}`);
    return {
      kind: 'resolved',
      frame,
      head: headOf(bare, [], siteFixes),
      beforeAfter: null,
      keep: null,
      resolved: `Verified resolved by the check of ${dayTimeUtc(verified.at)}.`,
    };
  }

  const free = freeFixes(d, check);
  const keep: FixKeep | null =
    keptUntil === null
      ? null
      : {
          title: `Keep this audit: we re-check ${bare.template_key ? 'the template' : 'the site'} monthly and email you if it regresses, and every fix is open for 14 days.`,
          sub: `One email creates a free account and starts 14 days of Pro. Otherwise this page expires ${frame.keptUntil}.`,
          primary: false,
        };
  const opens = plan === 'pro' || free.some((x) => x.id === fixId);
  const beforeAfter = beforeAfterOf(check, bare, live);

  if (!opens) {
    return {
      ...lockedPart(frame, free.length),
      frame,
      head: headOf(bare, [], siteFixes),
      beforeAfter,
      keep: keep && { ...keep, primary: true },
    };
  }

  const p = fix.packet;
  const pages = bare.affected_pages > 1 ? `the ${count(bare.affected_pages)} pages` : 'the page';
  const shipped =
    keptUntil === null || !rerun
      ? null
      : {
          heading: "When you've shipped it",
          body: `Mark it done and we re-crawl ${pages} now, about ${RECHECK_MINUTES} minutes. With an account the before and after is kept in Changes; without one the new result replaces this audit. If the number does not move, the fix stays open and the packet says what we saw.`,
          action: { label: 'Mark done and re-check now', href: keepHref },
        };
  if (!p) {
    return {
      kind: 'open',
      frame,
      head: headOf(bare, [], siteFixes),
      beforeAfter,
      // With no packet to copy, keeping the audit is the reader's next step.
      keep: keep && { ...keep, primary: true },
      packet: null,
      notWritten: noPacketLine(noPacketReason(bare.type)),
      switcher: null,
      shipped,
    };
  }
  const written = packetBodies(p);
  const switchable = written.length > 1;
  const bodies: PacketBodyView[] = written.map((b, i) => ({
    key: b.framework,
    label: FRAMEWORK_LABELS[b.framework],
    stack: `${writtenFor(check, b.framework, { own: i === 0, switchable })} Copy it as a prompt or hand it to a developer.`,
    block: packetBlock(check, bare, b),
    prompt: packetPrompt(bare, b),
  }));
  const own = written[0]!;
  return {
    kind: 'open',
    frame,
    head: headOf(bare, packetParagraph(own), siteFixes),
    beforeAfter,
    keep,
    packet: { bodies, download: `fix-${bare.number}-${slug(bare.title)}.md` },
    notWritten: null,
    switcher: switchable
      ? {
          heading:
            own.framework === 'generic' ? CHOOSE : `Not on ${FRAMEWORK_LABELS[own.framework]}?`,
          detected: detectedOf(check),
          options: bodies.map(({ key, label }) => ({ key, label })),
        }
      : null,
    shipped,
  };
}
