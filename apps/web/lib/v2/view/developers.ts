/**
 * The v2 Developers page as data (CC-29 D5). Its JSON example is a public contract (DECISION J13),
 * so it is built here from a check of the frozen fixture, in the field names the type contract
 * gives (`CrawlerResult` and `Effect` follow the FACTS Developers JSON), and never typed:
 * `developers.test.ts` parses each part against `@crawlmouse/types/v2`.
 *
 * The check is the bad-site fixture's scheduled check of Fri 30 Oct, the dashboard sample FACTS
 * names: the one the artboard's example shows (AI readability 22, a robots.txt block found that day).
 */
import type { Check, Effect, Verdict } from '@crawlmouse/types/v2';
import { GATES } from '../../entitlement-v2';
import { DEVELOPERS_COPY as COPY } from '../copy/developers';
import { findCheck, fixesAsOf, fixture, siteOf, type ViewDataset } from '../fixtures';
import { capitalise, count, numberWord } from '../words';

/** The dashboard sample's weekly check (FACTS: Fri 30 Oct 2026). */
export const API_SAMPLE_CHECK = 'c0000000-0000-4000-8000-000000000006';

/** A URL the sample does not spell out. */
export const ELIDED = '…';

/** The two verdicts the word "blocked" names (FACTS I2): the rows the sample shows. */
const BLOCKED: readonly Verdict[] = ['disallowed_by_robots', 'blocked_by_ua_rule'];

export interface ApiSample {
  audited_at: string;
  grades: { technical_seo: number | null; ai_readability: number | null };
  crawlers: Pick<
    Check['crawlers'][number],
    'ua' | 'verdict' | 'status' | 'pages_measured' | 'cause'
  >[];
  fixes: {
    id: number;
    title: string;
    effect: Pick<Effect, 'technical_seo' | 'ai_readability'>;
    packet_url: string;
  }[];
  links: { nodes: number; edges: number; orphans: number; csv_url: string };
}

export interface ApiSampleShown {
  sample: ApiSample;
  host: string;
  crawlersTotal: number;
  fixesTotal: number;
}

/**
 * The latest-audit response for one finished check: its grades, the crawler rows the check found
 * blocked, its open fix ranked first, and its link counts.
 */
export function apiSample(d: ViewDataset, checkId: string): ApiSampleShown {
  const check = findCheck(d, checkId);
  if (check.status !== 'finished' || !check.finished_at || !check.structure || !check.coverage) {
    throw new Error(`apiSample: check ${checkId} has not finished`);
  }
  const fixes = fixesAsOf(d, check);
  const first = fixes[0];
  const ai = check.ai_readability;
  return {
    host: siteOf(d, check).host,
    crawlersTotal: check.crawlers.length,
    fixesTotal: fixes.length,
    sample: {
      audited_at: check.finished_at,
      grades: {
        technical_seo: check.technical_seo?.score ?? null,
        ai_readability: ai && !ai.withheld ? ai.total : null,
      },
      crawlers: check.crawlers
        .filter((c) => BLOCKED.includes(c.verdict))
        .map(({ ua, verdict, status, pages_measured, cause }) => ({
          ua,
          verdict,
          status,
          pages_measured,
          cause,
        })),
      fixes: first
        ? [
            {
              id: first.number,
              title: first.title,
              effect: {
                technical_seo: first.effect.technical_seo,
                ai_readability: first.effect.ai_readability,
              },
              packet_url: ELIDED,
            },
          ]
        : [],
      links: {
        nodes: check.coverage.pages_crawled,
        edges: check.structure.internal_links,
        orphans: check.structure.orphan_pages,
        csv_url: ELIDED,
      },
    },
  };
}

/** One value on one line, with a space after each colon and comma, as the artboard sets it. */
function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`);
    return `{ ${entries.join(', ')} }`;
  }
  return JSON.stringify(value);
}

/** The sample as JSON: each top-level field on its line, each array item on its own. */
export function formatSample(sample: ApiSample): string {
  const fields = Object.entries(sample).map(([k, v]) => {
    const value = Array.isArray(v)
      ? v.length
        ? `[\n${v.map((item) => `    ${inline(item)}`).join(',\n')}\n  ]`
        : '[]'
      : inline(v);
    return `  ${JSON.stringify(k)}: ${value}`;
  });
  return `{\n${fields.join(',\n')}\n}`;
}

export interface DevelopersView {
  title: string;
  description: string;
  h1: string;
  intro: string;
  sample: {
    title: string;
    coming: string;
    request: string;
    json: string;
    shown: string;
    notes: string;
  };
  roadmap: {
    title: string;
    sub: string;
    rows: { item: string; code?: string; status: string }[];
  };
  waitlist: (typeof COPY)['waitlist'];
  closing: { title: string; sub: string; formLabel: string; homeLink: string };
}

export function developersView(): DevelopersView {
  const d = fixture('bad-site');
  const { sample, host, crawlersTotal, fixesTotal } = apiSample(d, API_SAMPLE_CHECK);
  const aiCrawlers = findCheck(d, API_SAMPLE_CHECK).crawlers.filter(
    (c) => c.group !== 'search_engine',
  ).length;
  const free = GATES.free.fixesVisible;
  return {
    title: COPY.title,
    description: COPY.description,
    h1: COPY.h1,
    intro: COPY.intro,
    sample: {
      title: COPY.sample.title,
      coming: COPY.sample.coming,
      request: COPY.sample.request(host),
      json: formatSample(sample),
      shown: COPY.sample.shown({
        crawlersShown: numberWord(sample.crawlers.length),
        crawlers: numberWord(crawlersTotal),
        fixesShown: numberWord(sample.fixes.length),
        fixes: numberWord(fixesTotal),
      }),
      notes: COPY.sample.notes,
    },
    roadmap: { ...COPY.roadmap, rows: [...COPY.roadmap.rows] },
    waitlist: COPY.waitlist,
    closing: {
      title: COPY.closing.title,
      sub: COPY.closing.sub({
        crawlers: capitalise(numberWord(aiCrawlers)),
        pages: count(GATES.free.pagesPerCheck),
        fixes: typeof free === 'number' ? numberWord(free) : 'all',
      }),
      formLabel: COPY.closing.formLabel,
      homeLink: COPY.closing.homeLink,
    },
  };
}
