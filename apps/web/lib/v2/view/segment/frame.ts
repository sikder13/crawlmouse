/**
 * What every segment page shares: the crumb, the section tabs, the back and next links, and how
 * long an unkept audit stays. The next link carries the next section's own figure, read from the
 * check, so it cannot disagree with that section's headline.
 */
import type { Check, FixSection } from '@crawlmouse/types/v2';
import { SCREEN_SIGNALS, screenSignals } from '../screen-signals';
import { findCheck, siteOf } from '../../fixtures';
import { dayTimeUtc, percent } from '../../format';
import { keptUntilOf } from '../result';
import { linksFacts } from './links-facts';
import type { ViewDataset } from '../../fixtures';
import type { FixPlan } from '../free-fixes';

export const SEGMENT_KEYS = [
  'access',
  'nojs',
  'structure',
  'links',
  'content',
  'signals',
  'changes',
] as const;
export type SegmentKey = (typeof SEGMENT_KEYS)[number];

export interface SegmentMeta {
  /** The tab's label. */
  tab: string;
  /** The page's name: the crumb, and the next link that leads to it. */
  title: string;
  /** How the back link that leads to it names it (the locked pages differ from both above). */
  backName: string;
  /** The fixes this section lists; Links and pages, Signals and Changes add none (FACTS B5). */
  section: FixSection | null;
}

export const SEGMENTS: Record<SegmentKey, SegmentMeta> = {
  access: {
    tab: 'Crawler access',
    title: 'Crawler access',
    backName: 'Crawler access',
    section: 'crawler_access',
  },
  nojs: {
    tab: 'Without JavaScript',
    title: 'Readable without JavaScript',
    backName: 'Without JavaScript',
    section: 'without_js',
  },
  structure: {
    tab: 'Structure',
    title: 'Site structure',
    backName: 'Site structure',
    section: 'structure',
  },
  links: {
    tab: 'Links and pages',
    title: 'Links and pages',
    backName: 'Links and pages',
    section: null,
  },
  content: {
    tab: 'Content',
    title: 'Content an answer engine can quote',
    backName: 'Content',
    section: 'content',
  },
  signals: {
    tab: 'Signals',
    title: 'Agent-readiness signals',
    backName: 'Signals',
    section: null,
  },
  changes: { tab: 'Changes', title: 'Changes', backName: 'Changes', section: null },
};

/**
 * The segments the locked screens do not have: Links and pages came after the lock (row 5), so its
 * tab and its door are marked as additions where they render (`data-v2-addition`).
 */
export const ADDED_SEGMENTS: readonly SegmentKey[] = ['links'];

/** The tab of segment `k`, as each page with the section tabs lists it. */
export const segmentTab = (k: SegmentKey, href: string, current: boolean) => ({
  label: SEGMENTS[k].tab,
  href,
  current,
  ...(ADDED_SEGMENTS.includes(k) ? { added: true } : {}),
});

/** Where the tabs and the back and next links go. Previews pass their routes; the default is "#". */
export interface SegmentHrefs {
  overview: string;
  segment: (key: SegmentKey) => string;
  /** The link-map explorer: zoomed to the hubs, and every page. Omitted, "#". */
  map?: { hubs: string; all: string };
  /** The result page of another check of the site, by its id. Omitted, the history links nowhere. */
  check?: (checkId: string) => string;
}

export const NO_HREFS: SegmentHrefs = { overview: '#', segment: () => '#' };

export interface SegmentOptions {
  /** Show a since-kept check as it was at its finish, as the Result preview does. */
  asFirstSeen?: boolean;
  hrefs?: SegmentHrefs;
  /** The reader's plan: Free opens the free fixes (free-fixes.ts), Pro opens every live fix. */
  plan?: FixPlan;
  /**
   * How many competitors the reader's plan compares, `GATES[tier].competitorsPerSite` (F-256): Signals
   * shows that many of the check's compared competitors in full. 0, the default, shows the first
   * one as the preview held for Pro.
   */
  competitors?: number;
  /**
   * Whether the page's header offers "Re-run, free", which the Changes page of a first audit
   * mentions. The previews show it; a page that has no such control passes false.
   */
  rerun?: boolean;
}

export interface SegmentLink {
  label: string;
  href: string;
}

export interface SegmentFrame {
  key: SegmentKey;
  domain: string;
  title: string;
  /** "26 Oct, 02:34 UTC" while nobody has kept the audit; null once an account keeps it. */
  keptUntil: string | null;
  tabs: (SegmentLink & { current: boolean; added?: boolean })[];
  back: SegmentLink;
  next: SegmentLink;
  /** Where an ask that needs an account goes: the keep bar, while there is one. */
  keepHref: string;
}

/** A section's own figure, as its next link shows it; null when the section has none. */
function figureOf(d: ViewDataset, check: Check, key: SegmentKey): string | null {
  switch (key) {
    case 'links':
      // The door's pill, so the tab and the door cannot disagree.
      return linksFacts(d, check).pill.label;
    case 'nojs':
      return check.without_js ? `${percent(check.without_js.site_text_share)}%` : 'not measured';
    case 'structure': {
      const s = check.technical_seo?.site_structure_score ?? null;
      return s === null ? 'not graded' : String(Math.round(s));
    }
    case 'content':
      return check.content
        ? check.content.score === null
          ? 'not scored yet'
          : String(check.content.score)
        : 'not measured';
    case 'signals': {
      const present = screenSignals(check).filter((s) => s.state === 'detected').length;
      return `${present} of ${SCREEN_SIGNALS.length}`;
    }
    case 'access':
    case 'changes':
      return null;
  }
}

export function segmentFrame(
  d: ViewDataset,
  checkId: string,
  key: SegmentKey,
  { asFirstSeen = false, hrefs = NO_HREFS }: SegmentOptions = {},
): SegmentFrame {
  const check = findCheck(d, checkId);
  const at = SEGMENT_KEYS.indexOf(key);
  const prev = SEGMENT_KEYS[at - 1];
  const next = SEGMENT_KEYS[at + 1];
  const keptUntil = keptUntilOf(d, check, asFirstSeen);
  const nextFigure = next ? figureOf(d, check, next) : null;
  return {
    key,
    domain: siteOf(d, check).host,
    title: SEGMENTS[key].title,
    keptUntil: keptUntil === null ? null : dayTimeUtc(keptUntil),
    keepHref: keptUntil === null ? '#' : '#keep',
    tabs: [
      { label: 'Overview', href: hrefs.overview, current: false },
      ...SEGMENT_KEYS.map((k) => segmentTab(k, hrefs.segment(k), k === key)),
    ],
    back: prev
      ? { label: `Back: ${SEGMENTS[prev].backName}`, href: hrefs.segment(prev) }
      : { label: 'Back to overview', href: hrefs.overview },
    next: next
      ? {
          label: `Next: ${SEGMENTS[next].title}${nextFigure === null ? '' : ` · ${nextFigure}`}`,
          href: hrefs.segment(next),
        }
      : { label: 'Back to overview', href: hrefs.overview },
  };
}
