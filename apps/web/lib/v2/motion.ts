/**
 * Everything that moves on the audit-flow screens: what moves, the event that moves it, how, and
 * for how long. The components read their timings from here and SPEC 22 renders this table, so the
 * spec cannot describe motion the code does not have.
 *
 * Rules that bind every entry (DESIGN-LOCK rules 10 and 13): motion only on a state change, nothing
 * infinite, no count-ups, only `transform`, `opacity` and stroke drawing animate, and under
 * `prefers-reduced-motion` nothing animates: each element is put in its final state as its event
 * lands. Where a duration or easing is a design token, `token` names it and motion.test.ts pins
 * the value to styles/v2/tokens.css.
 */

export interface MotionEntry {
  what: string;
  trigger: string;
  motion: string;
  duration_ms: number;
  easing: string;
  /** The tokens the duration and easing come from, when they do. */
  token?: { duration?: string; easing?: string };
}

const EASE_POP = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const EASE_GROW = 'cubic-bezier(0.3, 0.7, 0.3, 1)';

export const MOTION = {
  step: {
    what: 'Step row',
    trigger: '`stage`',
    motion: 'the row’s state word and colour cross-fade',
    duration_ms: 200,
    easing: 'ease-out',
  },
  counters: {
    what: 'Elapsed time, pages, links',
    trigger: 'each second of the clock; `counts`',
    motion: 'the text is replaced; no tween (rule 10: no count-ups)',
    duration_ms: 0,
    easing: 'none',
  },
  progressBar: {
    what: 'Progress bar',
    trigger: '`counts`',
    motion: '`scaleX` to pages crawled ÷ pages estimated',
    duration_ms: 300,
    easing: EASE_GROW,
    token: { easing: '--v2-ease-grow' },
  },
  nodeAppears: {
    what: 'Map node appears',
    trigger: '`page_fetched` by the crawl',
    motion: 'pops in at the page whose link reached it: opacity 0 → 1, scale 0.2 → 1',
    duration_ms: 500,
    easing: EASE_POP,
    token: { duration: '--v2-motion-pop', easing: '--v2-ease-pop' },
  },
  mapSettles: {
    what: 'Map settles',
    trigger: 'a layout from the Worker, at most one a second',
    motion: 'each node moves from where it was drawn to its new place (FLIP translate)',
    duration_ms: 600,
    easing: EASE_GROW,
    token: { easing: '--v2-ease-grow' },
  },
  edgeDraws: {
    what: 'Link draws',
    trigger: 'a node placed under the page whose link reached it',
    motion: 'stroke drawn from the parent outwards (stroke-dashoffset to 0)',
    duration_ms: 900,
    easing: 'ease-out',
    token: { duration: '--v2-motion-draw' },
  },
  classified: {
    what: 'Orphan or JavaScript-only node lights up',
    trigger: '`page_classified`',
    motion: 'the shape and colour change in place, with one pop',
    duration_ms: 500,
    easing: EASE_POP,
    token: { duration: '--v2-motion-pop', easing: '--v2-ease-pop' },
  },
  logLine: {
    what: 'Fetch log line',
    trigger: '`page_fetched`, at most four lines a second; faster lines appear in place',
    motion: 'the newest line rises 6 px and fades in; the others move up a slot as text, not boxes',
    duration_ms: 200,
    easing: 'ease-out',
  },
  finding: {
    what: 'Finding',
    trigger: '`finding`',
    motion: 'fades in, rising 6 px',
    duration_ms: 600,
    easing: 'ease-out',
    token: { duration: '--v2-motion-fade' },
  },
  verdict: {
    what: 'Crawler verdict',
    trigger: '`crawler_verdict`',
    motion: '“not tested yet” gives way to the verdict pill, a cross-fade',
    duration_ms: 500,
    easing: 'ease-out',
  },
  gradeReveal: {
    what: 'Grade reveal',
    trigger: '`graded`, once',
    motion: 'the two grade cards and the result button fade in, rising 6 px',
    duration_ms: 600,
    easing: 'ease-out',
    token: { duration: '--v2-motion-fade' },
  },
  still: {
    what: 'After the end',
    trigger: '`ended`, or the moment an open recording covers to',
    motion: 'nothing moves, and no timer is left running',
    duration_ms: 0,
    easing: 'none',
  },
} satisfies Record<string, MotionEntry>;

export type MotionName = keyof typeof MOTION;

/**
 * The fewest milliseconds between two layouts landing on the map: a layout moves every node, so
 * each is a heavy frame, and one a second is enough for the map to read as settling.
 */
export const LAYOUT_GAP_MS = 1000;

/** The fewest milliseconds between two fetch-log lines: four a second at most. */
export const LOG_LINE_GAP_MS = 250;

/** True when the reader asked for less motion. Server-side, and without matchMedia, false. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
