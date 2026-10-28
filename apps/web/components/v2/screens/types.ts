import type { PillState } from '../StatusPill';

/**
 * What the two reference screens render, as plain data. The preview pages fill these from
 * fixtures holding the locked screens' values; a later step maps the CC-11 contract onto them.
 * Numbers that a sentence states are kept as numbers, so the sentence is built from them.
 */

export interface PillValue {
  state: PillState;
  label: string;
}

export interface ScreenGrade {
  label: string;
  letter: string;
  score: number;
  tone: 'default' | 'bad';
  summary: string;
}

export interface CrawlerRow {
  crawler: string;
  homepage: PillValue;
  productPages: PillValue;
  /** Percent of the page text this crawler can read. */
  textPercent: number;
  obstacle: string;
}

export interface HomeScreenData {
  example: {
    domain: string;
    duration: string;
    pagesCrawled: number;
    pagesTotal: number;
    links: number;
    grades: [ScreenGrade, ScreenGrade];
  };
  crawlers: {
    productPages: number;
    rows: CrawlerRow[];
  };
  withoutJs: {
    path: string;
    browserWords: number;
    bot: string;
    botWords: number;
    templatePages: number;
  };
  alert: {
    title: string;
    time: string;
    domain: string;
    changedFile: string;
    changedAt: string;
    pagesAffected: number;
    diff: { context: string; removed: string; added: string };
  };
}

export interface ResultDoor {
  title: string;
  pill: PillValue;
  /** The thin bar under the title: how far along, in which tone. */
  bar?: { percent: number; tone: 'bad' | 'warn' | 'neutral' };
  body: string;
  footer: string;
  href: string;
  /** The door to a section that only exists once the audit is kept. */
  keep?: boolean;
}

export interface ResultFix {
  title: string;
  /** Shown after the title, muted, e.g. "158 pages". */
  scope?: string;
  points: string;
  /** Open free (true) or behind Pro (false). */
  open: boolean;
  /** How many fixes this row stands for: 1, or a group such as "Nine more". */
  count: number;
  href: string;
}

export interface ResultScreenData {
  domain: string;
  crawl: {
    pagesCrawled: number;
    pagesTotal: number;
    crawledAt: string;
    keptUntil: string;
  };
  grades: [ScreenGrade, ScreenGrade];
  fixFirst: { title: string; body: string; href: string };
  doors: ResultDoor[];
  fixes: { total: number; rows: ResultFix[] };
  map: { pages: number; links: number; orphans: number; href: string };
}
