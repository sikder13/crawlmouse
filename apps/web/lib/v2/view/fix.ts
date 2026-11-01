/**
 * The fix page (Final-Fix): one fix of one audit, its estimated effect and, when the reader's plan
 * opens it, the packet. Which plan opens which fix is the free-fix rule (free-fixes.ts); the
 * contract stores no plan (fix.ts, `packet`). A locked fix's view is built without reading its
 * packet at all, so no part of it can reach the page: everything but the open branch takes the
 * fix as `withoutPacket` copies it, and fix.test.ts makes the field throw when read.
 */
import type {
  Check,
  CrawlerResult,
  Fix,
  FixtureDataset,
  PacketFramework,
} from '@crawlmouse/types/v2';
import { instant } from '@crawlmouse/types/v2';
import { findCheck, fixesAsOf, siteOf } from '../fixtures';
import { dayTimeUtc, listOf, percent } from '../format';
import { count, plural } from '../words';
import { freeFixes } from './free-fixes';
import { keptUntilOf, points } from './result';
import {
  effectOf,
  effortText,
  packetParagraph,
  packetPrompt,
  recommendation,
  type FixPacket,
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

export type FixPlan = 'free' | 'pro';

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

export interface FrameworkOption {
  key: PacketFramework;
  label: string;
  current: boolean;
  /** What choosing it shows: null for the packet's own framework. */
  note: string | null;
}

export interface OpenFixPage extends FixBase {
  kind: 'open';
  /** Null when no packet was written for this fix (the contract allows it); the page says so. */
  packet: {
    /** Which stack the packet is written for, from the check's detected stack. */
    stack: string;
    /** The packet as the page's block shows it, under its four headings. */
    block: string;
    /** The packet as plain text, for "Copy as a prompt" (the segment copies the same text). */
    prompt: string;
    /** The file name "Download as .md" saves. */
    download: string;
  } | null;
  /** The framework switch; null for a packet written for any stack. */
  switcher: { heading: string; detected: string | null; options: FrameworkOption[] } | null;
  shipped: { heading: string; body: string; action: SegmentLink };
}

export interface LockedFixPage extends FixBase {
  kind: 'locked';
  wall: { heading: string; body: string; action: SegmentLink };
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

function headOf(f: Omit<Fix, 'packet'>, lede: string[]): FixHead {
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
    ...effectOf(f),
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
          footnote = `* ${ai.length} of ${ai.length} once ${plural(numbers.length, 'fix', 'fixes')} ${listOf(numbers)}, in ${listOf(sections)}, ${plural(numbers.length, 'is', 'are')} also done.`;
        }
        return {
          label: 'AI crawlers that read the text',
          today: `${count(Number(r.today))} of ${ai.length}`,
          after: `${count(after)} of ${ai.length}${waits ? '*' : ''}`,
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

/** "Next.js 14, pages router, Shopify as the backend", from the check's detected stack. */
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
      ? `${CMS_LABELS[s.backend.cms]} as the backend`
      : CMS_LABELS[s.backend.cms]
    : null;
  return [front, back].filter(Boolean).join(', ') || null;
}

/** "The audit detected Next.js from the asset paths and Shopify from the product API calls." */
function detectedOf(check: Check): string | null {
  const s = check.stack;
  const parts = [
    s?.frontend ? `${s.frontend.name} from ${s.frontend.detected_from}` : null,
    s?.backend ? `${CMS_LABELS[s.backend.cms]} from ${s.backend.detected_from}` : null,
  ].filter((x): x is string => x !== null);
  return parts.length ? `The audit detected ${listOf(parts)}.` : null;
}

/** The packet under its four headings, with the check's crawler and what we run afterwards. */
function packetBlock(check: Check, f: Fix, p: FixPacket): string {
  const indent = (lines: readonly string[]) => lines.map((l) => `  ${l}`);
  const crawler = p.verify.ua ? check.crawlers.find((c) => c.ua === p.verify.ua) : undefined;
  const got = crawler ? (crawler.status === null ? 'robots.txt' : String(crawler.status)) : null;
  const verify = [
    p.verify.command,
    `  → expect ${p.verify.expect}`,
    // FACTS D1: a curl request is our tagged request's twin, not the same request.
    ...(p.verify.command.startsWith('curl ')
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
    ...indent(p.context),
    '',
    'Change',
    ...indent(p.change),
    ...(p.keep.length ? ['', 'Keep', ...indent(p.keep)] : []),
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
  return {
    kind: 'locked',
    wall: {
      heading: 'The packet',
      body: `The steps for this fix, what to keep, and the check we run afterwards are on Pro. Free opens the ${plural(free, 'fix', `${free} fixes`)} with the largest estimated effect; keeping this audit starts 14 days of Pro, with every fix open.`,
      action: { label: 'See this fix with Pro', href: frame.keepHref },
    },
  };
}

/** The fix without its packet, copied field by field so the packet is never read. */
function withoutPacket(f: Fix): Omit<Fix, 'packet'> {
  const keys = Object.keys(f).filter((k) => k !== 'packet') as (keyof Omit<Fix, 'packet'>)[];
  return Object.fromEntries(keys.map((k) => [k, f[k]])) as Omit<Fix, 'packet'>;
}

export function fixView(
  d: FixtureDataset,
  checkId: string,
  fixId: string,
  { plan = 'free', asFirstSeen = false, hrefs = NO_HREFS }: FixOptions = {},
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
    position: at >= 0 ? `Fix ${bare.number} of ${live.length}` : `Fix ${bare.number}, resolved`,
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
              label: `Next fix: ${following.title} · ${points(following)}`,
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
      head: headOf(bare, []),
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
      head: headOf(bare, []),
      beforeAfter,
      keep: keep && { ...keep, primary: true },
    };
  }

  const p = fix.packet;
  const pages = bare.affected_pages > 1 ? `the ${count(bare.affected_pages)} pages` : 'the page';
  const shipped = {
    heading: 'When you’ve shipped it',
    body: `Mark it done and we re-crawl ${pages} now, about 2 minutes. With an account the before and after is kept in Changes; without one the new result replaces this audit. If the number does not move, the fix stays open and the packet says what we saw.`,
    action: { label: 'Mark done and re-check now', href: keepHref },
  };
  if (!p) {
    return {
      kind: 'open',
      frame,
      head: headOf(bare, []),
      beforeAfter,
      keep,
      packet: null,
      switcher: null,
      shipped,
    };
  }
  const stack = p.framework === 'generic' ? null : stackOf(check);
  return {
    kind: 'open',
    frame,
    head: headOf(bare, packetParagraph(p)),
    beforeAfter,
    keep,
    packet: {
      stack: stack
        ? `Written for your stack as detected: ${stack}. Copy it as a prompt or hand it to a developer.`
        : 'Written for any stack. Copy it as a prompt or hand it to a developer.',
      block: packetBlock(check, fix, p),
      prompt: packetPrompt(fix, p),
      download: `fix-${bare.number}-${slug(bare.title)}.md`,
    },
    switcher:
      p.framework === 'generic'
        ? null
        : {
            heading: `Not on ${FRAMEWORK_LABELS[p.framework]}?`,
            detected: detectedOf(check),
            options: p.frameworks.map((k) => ({
              key: k,
              label: FRAMEWORK_LABELS[k],
              current: k === p.framework,
              note:
                k === p.framework
                  ? null
                  : `The audit has no packet for ${FRAMEWORK_LABELS[k]} yet. The packet above is written for ${FRAMEWORK_LABELS[p.framework]}.`,
            })),
          },
    shipped,
  };
}
