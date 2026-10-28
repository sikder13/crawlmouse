/**
 * The crawl-in-progress screen as data: one frame for each state of the replayed stream. Pure, so
 * the frame at a moment is the same on the server, in the browser, with motion and without.
 */
import type { CrawlerResult } from '@crawlmouse/types/v2';
import { clock } from '../format';
import { toneOf } from '../letters';
import type { CheckPhase, CrawlState, FetchEvent } from '../progress';
import { capitalise, count, numberWord, plural } from '../words';
import { FREE_FIXES, type GradeView } from './result';

/** The step names, as the locked screen words them: past tense once done, otherwise ongoing. */
export const STEP_LABELS: Record<CheckPhase, { done: string; ongoing: string }> = {
  robots_and_sitemap: {
    done: 'Read robots.txt and the sitemap',
    ongoing: 'Reading robots.txt and the sitemap',
  },
  homepage: {
    done: 'Fetched the homepage as a browser',
    ongoing: 'Fetching the homepage as a browser',
  },
  crawl: { done: 'Crawled pages and mapped links', ongoing: 'Crawling pages and mapping links' },
  // FACTS B8: "Fetching each page as 6 crawlers" → "Fetching a sample of pages as each AI crawler".
  crawler_tests: {
    done: 'Fetched a sample of pages as each AI crawler',
    ongoing: 'Fetching a sample of pages as each AI crawler',
  },
  without_js: {
    done: 'Measured text without JavaScript',
    ongoing: 'Measuring text without JavaScript',
  },
  grading: { done: 'Graded', ongoing: 'Grading' },
};

/** The status panel's heading, by the step under way. */
const HEADINGS: Record<CheckPhase, string> = {
  robots_and_sitemap: 'Reading robots.txt',
  homepage: 'Fetching the homepage',
  crawl: 'Crawling',
  crawler_tests: 'Testing AI crawlers',
  without_js: 'Measuring text',
  grading: 'Grading',
};

/** How many fetch lines the log shows: the locked screen's five. */
export const LOG_LINES = 5;

export interface CrawlContext {
  domain: string;
  /** The AI crawlers the check tests, in the order the panel lists them. */
  crawlers: Pick<CrawlerResult, 'ua' | 'scored'>[];
}

export interface CrawlFrame {
  /** Above the domain and beside it: the locked "Auditing" while it runs, then what became of it. */
  title: { eyebrow: string; note: string };
  /** Whether there is still an audit to cancel. */
  cancellable: boolean;
  heading: string;
  /** "0:47". */
  clock: string;
  /** "0:47 elapsed", or "2:11 in all" once it has ended. */
  elapsed: string;
  finished: boolean;
  /**
   * Whether the map has its last pages: grading has begun, which the stages reach only after the
   * crawl and both tests, or the stream has ended. Every page, link and class is in by then.
   */
  mapComplete: boolean;
  /** Once it has ended: how long it took, and whether every page it found was crawled. */
  revealLabel: string | null;
  /** Once it has ended: how many fixes were found and how many the free result opens. */
  outcome: string | null;
  /** Pages crawled of the estimate; null, and nothing drawn, until there is an estimate. */
  bar: { value: number; max: number; text: string } | null;
  pagesText: string;
  linksText: string;
  steps: { key: CheckPhase; label: string; state: 'done' | 'now' | 'next' }[];
  findings: { key: string; title: string; at: string }[];
  log: {
    heading: string;
    /** `request` as shown, a long path shortened; `full` with the whole path, for screen readers. */
    lines: { key: string; request: string; full: string; answer: string; time: string }[];
  };
  /** Whether the crawler tests have begun: the verdict panel waits until then. */
  testsStarted: boolean;
  verdicts: {
    ua: string;
    scored: boolean;
    /** Requested as this crawler, its verdict not yet landed. */
    testing: boolean;
    verdict: CrawlerResult['verdict'] | null;
    evidence: CrawlerResult['evidence_class'] | null;
  }[];
  grades: [GradeView, GradeView] | null;
  /** Once graded: the reveal as one sentence, for a screen reader's status message. */
  announcement: string;
}

/**
 * The most characters a log line shows: what the desktop log panel holds in its monospace face,
 * less a little (a 62-character line measured 434px against the panel's 400). A line that would be
 * longer has its path cut, by as much as it takes. On a phone the log shows each path whole and
 * wraps the line (CrawlScreen).
 */
export const LOG_LINE_MAX = 56;

/** The shortest a path is cut to, however much else the line holds. */
const LOG_PATH_MIN = 12;

/**
 * "/journal/…season": a long path's first folder and as much of its end as fits, the middle marked
 * as left out. The end starts at a word ('-' or '/'), so no word is cut in two; it may be shorter
 * than the room left.
 */
export function shortPath(path: string, max: number): string {
  // By code point, the repo's safe cut; a URL's pathname is percent-encoded ASCII in any case.
  const chars = [...path];
  if (chars.length <= max) return path;
  // The first folder ("/journal/") when it leaves room for some of the end, else the root slash.
  const folder = chars.indexOf('/', 1);
  const head = folder > 0 && folder + 1 <= max - 5 ? folder + 1 : 1;
  let start = chars.length - (max - 1 - head);
  while (start < chars.length && !/[-/]/.test(chars[start - 1] ?? '')) start++;
  return `${chars.slice(0, head).join('')}…${chars.slice(start).join('')}`;
}

/**
 * A log line in parts: what was requested, what came back, and how long it took. The requester
 * (`identity`: a crawler's token, `browser` or `render`) is named in the line only when the lines
 * shown do not share one; otherwise the heading names it.
 */
function logLine(
  f: Omit<FetchEvent, 'type'>,
  shared: boolean,
): { request: string; full: string; answer: string; time: string } {
  const whole = new URL(f.url).pathname;
  // No-break spaces keep a number with its unit when a phone's narrow log wraps the line.
  const time = `· ${count(f.ms)}\u00a0ms`;
  const who = shared ? '' : `${f.identity} `;
  const answer =
    f.purpose === 'crawl'
      ? `→ ${f.status} · ${count(f.links)}\u00a0${plural(f.links, 'link', 'links')}`
      : `→ ${f.status}`;
  // The room the path has: the line's budget less everything else on it and its two spaces.
  const rest = [...`${who}GET  ${answer} ${time}`].length;
  const path = shortPath(whole, Math.max(LOG_PATH_MIN, LOG_LINE_MAX - rest));
  return { request: `${who}GET ${path}`, full: `${who}GET ${whole}`, answer, time };
}

/** Whose requests the log is showing: one requester named once, or none, each line naming its own. */
function logHeading(lines: Omit<FetchEvent, 'type'>[]): { heading: string; shared: boolean } {
  const who = new Set(lines.map((f) => f.identity));
  if (!lines.length) return { heading: 'Recent fetches', shared: true };
  if (who.size > 1) return { heading: 'Recent fetches', shared: false };
  const only = [...who][0]!;
  const heading =
    only === 'browser'
      ? 'Recent fetches · as a browser'
      : only === 'render'
        ? 'Recent fetches · rendered in a browser'
        : `Recent fetches · as ${only}`;
  return { heading, shared: true };
}

export function crawlFrame(state: CrawlState, ctx: CrawlContext): CrawlFrame {
  const now = state.steps.find((s) => s.state === 'now');
  const finished = state.ended !== null;
  const heading = finished
    ? state.ended === 'partial'
      ? 'Finished, partly'
      : state.ended === 'failed'
        ? 'Stopped'
        : 'Finished'
    : now
      ? HEADINGS[now.phase]
      : 'Starting';
  const estimate = state.pages_estimated;
  const recent = state.fetches.slice(-LOG_LINES);
  const pagesText = finished
    ? state.ended !== 'finished' && estimate !== null
      ? `${count(state.pages_crawled)} of about ${count(estimate)} pages`
      : `${count(state.pages_crawled)} ${plural(state.pages_crawled, 'page', 'pages')} crawled`
    : estimate === null
      ? `${count(state.pages_crawled)} ${plural(state.pages_crawled, 'page', 'pages')}`
      : `${count(state.pages_crawled)} of about ${count(estimate)} pages`;
  const n = state.findings.length;
  const open = Math.min(n, FREE_FIXES);
  const revealLabel = !finished
    ? null
    : state.ended === 'partial' && estimate !== null
      ? `Finished in ${clock(state.elapsed_ms)}, with ${count(state.pages_crawled)} of about ${count(estimate)} pages crawled`
      : `${heading} in ${clock(state.elapsed_ms)}`;
  const grades = state.grades ? gradeViews(state.grades) : null;
  return {
    title: !finished
      ? {
          eyebrow: 'Auditing',
          note: 'Usually about two minutes. You can leave this page; the result keeps building.',
        }
      : state.ended === 'failed'
        ? { eyebrow: 'Audit stopped', note: 'It stopped before it could finish.' }
        : { eyebrow: 'Audited', note: 'The result is ready.' },
    cancellable: !finished,
    heading,
    clock: clock(state.elapsed_ms),
    elapsed: `${clock(state.elapsed_ms)} ${finished ? 'in all' : 'elapsed'}`,
    finished,
    mapComplete: finished || state.steps.find((s) => s.phase === 'grading')?.state !== 'next',
    revealLabel,
    outcome: !finished
      ? null
      : n === 0
        ? 'Nothing to fix'
        : `${capitalise(numberWord(n))} ${plural(n, 'fix', 'fixes')} found; ${
            open === n
              ? n === 1
                ? 'it is'
                : n === 2
                  ? 'both are'
                  : 'all are'
              : `the first ${numberWord(open)} are`
          } open, free`,
    bar: (() => {
      // D3: pages crawled of the estimate, never printed as a percent, absent with no estimate.
      // A crawl that finished reached every page it found, so its bar is full whatever the
      // estimate said; one cut short stays at its share of the estimate.
      const max = state.ended === 'finished' ? state.pages_crawled : estimate;
      return max ? { value: Math.min(state.pages_crawled, max), max, text: pagesText } : null;
    })(),
    pagesText,
    linksText: finished
      ? `${count(state.links_found)} ${plural(state.links_found, 'link', 'links')}`
      : `${count(state.links_found)} ${plural(state.links_found, 'link', 'links')} found so far`,
    steps: state.steps.map((s) => ({
      key: s.phase,
      label: s.state === 'done' ? STEP_LABELS[s.phase].done : STEP_LABELS[s.phase].ongoing,
      state: s.state,
    })),
    findings: [...state.findings].reverse().map((f) => ({
      key: f.fingerprint,
      title: f.title,
      at: clock(findingTime(state, f.fingerprint)),
    })),
    log: (() => {
      const { heading, shared } = logHeading(recent);
      return {
        heading,
        lines: recent.map((f, i) => ({
          key: `${state.fetches.length - recent.length + i}`,
          ...logLine(f, shared),
        })),
      };
    })(),
    testsStarted: state.steps.some((s) => s.phase === 'crawler_tests' && s.state !== 'next'),
    verdicts: ctx.crawlers.map((c) => {
      const v = Object.hasOwn(state.verdicts, c.ua) ? state.verdicts[c.ua] : undefined;
      return {
        ua: c.ua,
        scored: c.scored,
        testing: !v && state.fetches.some((f) => f.purpose === 'test' && f.identity === c.ua),
        verdict: v?.verdict ?? null,
        evidence: v?.evidence_class ?? null,
      };
    }),
    grades,
    announcement: grades
      ? `${revealLabel}. ${grades
          .map((g) =>
            g.withheld ? `${g.label} withheld` : `${g.label} ${g.letter}, ${g.score} of 100`,
          )
          .join('. ')}.`
      : '',
  };
}

function findingTime(state: CrawlState, fingerprint: string): number {
  return state.findings.find((f) => f.fingerprint === fingerprint)!.at_ms;
}

function gradeViews(g: NonNullable<CrawlState['grades']>): [GradeView, GradeView] {
  const t = g.technical_seo;
  const ai = g.ai_readability;
  return [
    {
      label: 'Technical SEO',
      letter: t.grade,
      score: t.score,
      tone: t.grade ? toneOf(t.grade) : 'default',
      withheld: t.grade === null,
      summary: '',
    },
    ai.withheld
      ? {
          label: 'AI readability',
          letter: null,
          score: null,
          tone: 'default',
          withheld: true,
          summary: '',
        }
      : {
          label: 'AI readability',
          letter: ai.grade,
          score: ai.total,
          tone: toneOf(ai.grade),
          withheld: false,
          summary: '',
        },
  ];
}
