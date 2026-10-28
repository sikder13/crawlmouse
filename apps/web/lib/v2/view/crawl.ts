/**
 * The crawl-in-progress screen as data: one frame for each state of the replayed stream. Pure, so
 * the frame at a moment is the same on the server, in the browser, with motion and without.
 */
import type { CrawlerResult } from '@crawlmouse/types/v2';
import { clock, listOf } from '../format';
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
  heading: string;
  /** "0:47". */
  clock: string;
  /** "0:47 elapsed", or "2:11 in all" once it has ended. */
  elapsed: string;
  finished: boolean;
  /** Once it has ended: how long it took, and whether every page it found was crawled. */
  revealLabel: string | null;
  /** Once it has ended: how many fixes were found and how many the free result opens. */
  outcome: string | null;
  bar: { value: number; max: number; text: string } | null;
  pagesText: string;
  linksText: string;
  steps: { key: CheckPhase; label: string; state: 'done' | 'now' | 'next' }[];
  findings: { key: string; title: string; at: string }[];
  log: {
    heading: string;
    lines: { key: string; request: string; answer: string; time: string }[];
  };
  verdicts: {
    ua: string;
    scored: boolean;
    verdict: CrawlerResult['verdict'] | null;
    evidence: CrawlerResult['evidence_class'] | null;
  }[];
  grades: [GradeView, GradeView] | null;
}

/** A log line in two parts: what was requested, and what came back. */
function logLine(f: Omit<FetchEvent, 'type'>): { request: string; answer: string; time: string } {
  const path = new URL(f.url).pathname;
  const time = `· ${count(f.ms)} ms`;
  if (f.purpose === 'crawl') {
    return {
      request: `GET ${path}`,
      answer: `→ ${f.status} · ${count(f.links)} ${plural(f.links, 'link', 'links')}`,
      time,
    };
  }
  if (f.purpose === 'render') return { request: `render ${path}`, answer: `→ ${f.status}`, time };
  return { request: `${f.identity} GET ${path}`, answer: `→ ${f.status}`, time };
}

/** Whose requests the log is showing: one identity, or the crawlers' own. */
function logHeading(lines: Omit<FetchEvent, 'type'>[]): string {
  const purposes = new Set(lines.map((l) => l.purpose));
  const identities = new Set(lines.map((l) => l.identity));
  if (!lines.length) return 'Recent fetches';
  if (purposes.has('test')) return 'Recent fetches · as each AI crawler';
  if (purposes.size === 1 && purposes.has('render'))
    return 'Recent fetches · rendered in a browser';
  if (identities.size === 1 && identities.has('browser')) return 'Recent fetches · as a browser';
  if (identities.size === 1 && identities.has('render'))
    return 'Recent fetches · rendered in a browser';
  return `Recent fetches · as ${listOf([...identities])}`;
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
    ? `${count(state.pages_crawled)} ${plural(state.pages_crawled, 'page', 'pages')} crawled`
    : estimate === null
      ? `${count(state.pages_crawled)} ${plural(state.pages_crawled, 'page', 'pages')}`
      : `${count(state.pages_crawled)} of about ${count(estimate)} pages`;
  const n = state.findings.length;
  const open = Math.min(n, FREE_FIXES);
  return {
    heading,
    clock: clock(state.elapsed_ms),
    elapsed: `${clock(state.elapsed_ms)} ${finished ? 'in all' : 'elapsed'}`,
    finished,
    revealLabel: !finished
      ? null
      : state.ended === 'partial' && estimate !== null
        ? `Finished in ${clock(state.elapsed_ms)}, with ${count(state.pages_crawled)} of about ${count(estimate)} pages crawled`
        : `${heading} in ${clock(state.elapsed_ms)}`,
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
    // D3: the bar is crawled ÷ estimated, never printed as a percent, and absent with no estimate.
    bar:
      estimate === null || finished
        ? null
        : { value: Math.min(state.pages_crawled, estimate), max: estimate, text: pagesText },
    pagesText,
    linksText: finished
      ? `${count(state.links_found)} ${plural(state.links_found, 'link', 'links')}`
      : `${count(state.links_found)} ${plural(state.links_found, 'link', 'links')} found so far`,
    steps: state.steps.map((s) => ({
      key: s.phase,
      label: s.state === 'done' ? STEP_LABELS[s.phase].done : STEP_LABELS[s.phase].ongoing,
      state: s.state,
    })),
    findings: [...state.findings]
      .reverse()
      .map((f) => ({
        key: f.fingerprint,
        title: f.title,
        at: clock(findingTime(state, f.fingerprint)),
      })),
    log: {
      heading: logHeading(recent),
      lines: recent.map((f, i) => ({
        key: `${state.fetches.length - recent.length + i}`,
        ...logLine(f),
      })),
    },
    verdicts: ctx.crawlers.map((c) => {
      const v = Object.hasOwn(state.verdicts, c.ua) ? state.verdicts[c.ua] : undefined;
      return {
        ua: c.ua,
        scored: c.scored,
        verdict: v?.verdict ?? null,
        evidence: v?.evidence_class ?? null,
      };
    }),
    grades: state.grades ? gradeViews(state.grades) : null,
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
