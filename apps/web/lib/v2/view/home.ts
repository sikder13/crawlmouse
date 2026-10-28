/**
 * The Home screen's example audit, its crawler table, its words-without-JavaScript card and its
 * alert card, as data from the bad-site fixture. The marketing copy around them is the component's.
 */
import type { AccessCause, CrawlerResult, FixtureDataset } from '@crawlmouse/types/v2';
import { crawlerOf, findCheck, fixesAsOf, siteOf, templateOf } from '../fixtures';
import { duration, percent, templateNoun, weekdayTime } from '../format';
import { mapLabel } from '../map-label';
import { toneOf } from '../letters';
import type { CrawlState } from '../progress';
import type { MapDrawing } from './map';
import type { GradeView } from './result';
import { FREE_FIXES } from './result';
import { aiShortSummary, seoShortSummary } from '../sentences';
import { capitalise } from '../words';

/** The four crawlers the locked Home table shows, in its order. Which crawlers is a layout choice. */
export const HOME_CRAWLERS = ['Googlebot', 'GPTBot', 'ClaudeBot', 'PerplexityBot'] as const;

export interface VerdictView {
  verdict: CrawlerResult['verdict'];
  evidence: CrawlerResult['evidence_class'];
}

export interface HomeView {
  example: {
    domain: string;
    duration: string;
    pagesCrawled: number;
    pagesTotal: number;
    links: number;
    grades: [GradeView, GradeView];
    map: MapDrawing;
    mapLabel: string;
  };
  crawlers: {
    productHeader: string;
    rows: {
      crawler: string;
      homepage: VerdictView;
      products: VerdictView;
      text: string;
      obstacle: string;
    }[];
  };
  withoutJs: {
    path: string;
    browserWords: number;
    bot: string;
    botWords: number;
    share: number;
    templatePages: number;
    templateNoun: string;
  };
  alert: {
    title: string;
    time: string;
    domain: string;
    changedFile: string;
    changedAt: string | null;
    pagesAffected: number;
    diff: { removed: string[]; added: string[] };
  };
}

function obstacle(c: CrawlerResult, productNoun: string): string {
  if (c.group === 'search_engine' && c.verdict === 'allowed') {
    return 'nothing: robots.txt allows it and it renders JavaScript';
  }
  const phrases: Record<AccessCause, string> = {
    cloudflare_1020: 'a Cloudflare firewall rule',
    bot_fight_mode: 'Bot Fight Mode',
    client_rendered_template: `the ${productNoun} template is client-rendered`,
    robots_txt_disallow: 'a robots.txt rule',
    automation_challenge: 'an automation challenge at the edge',
    rate_limit_429: 'rate limiting',
    pay_per_crawl_402: 'pay per crawl',
    cross_host_redirect: 'a redirect to another host',
    verified_bot_only: 'an edge that admits only verified crawlers',
  };
  return c.cause ? phrases[c.cause] : 'nothing';
}

/**
 * `end` is the crawl screen's replay at its end, so Home's example is that replay scrubbed to its
 * last frame; its counts are the stream's own (synthesise.test.ts shows they equal the check's).
 */
export function homeView(
  d: FixtureDataset,
  checkId: string,
  { map, end }: { map: MapDrawing; end: CrawlState },
): HomeView {
  if (end.ended === null || !end.grades || end.pages_estimated === null) {
    throw new Error('Home shows the replay at its end');
  }
  const check = findCheck(d, checkId);
  const site = siteOf(d, check);
  const coverage = check.coverage!;
  const t = end.grades.technical_seo;
  const ai = end.grades.ai_readability;
  if (ai.withheld || t.grade === null || t.score === null) {
    throw new Error('The Home example is a graded audit');
  }
  const fixes = fixesAsOf(d, check);
  const isOpen = (f: (typeof fixes)[number]) => fixes.indexOf(f) < FREE_FIXES;

  // The template most pages share: the one the table's second verdict column is about.
  const product = [...coverage.templates]
    .filter((x) => x.template_key !== '/')
    .sort((a, b) => b.pages - a.pages)[0]!;
  const productNoun = templateNoun(product.label);
  const cell = (c: CrawlerResult, key: string): VerdictView => {
    const byT = c.by_template.find((x) => x.template_key === key);
    if (!byT) throw new Error(`${c.ua} has no verdict for ${key}`);
    return { verdict: byT.verdict, evidence: c.evidence_class };
  };

  // The example of words lost without JavaScript: the sampled page that loses the most.
  const page = d.page_results
    .filter((p) => p.check_id === check.id && p.sampled && p.without_js?.state === 'empty_shell')
    .sort(
      (a, b) =>
        b.without_js!.rendered_words -
        b.without_js!.raw_words -
        (a.without_js!.rendered_words - a.without_js!.raw_words),
    )[0];
  if (!page?.without_js) throw new Error('No sampled page is an empty shell');
  const pageKey = templateOf(
    coverage.templates.map((x) => x.template_key),
    page.url,
  );
  const pageTemplate = coverage.templates.find((x) => x.template_key === pageKey)!;
  // What a crawler that does not run scripts receives: one the site lets in, on that template,
  // preferring one of the crawlers the table above has already named.
  const readsThin = (c: CrawlerResult) =>
    c.group !== 'search_engine' &&
    c.by_template.some(
      (x) => x.template_key === pageTemplate.template_key && x.verdict === 'allowed_thin',
    );
  const bot =
    HOME_CRAWLERS.map((ua) => check.crawlers.find((c) => c.ua === ua)).find(
      (c): c is CrawlerResult => c !== undefined && readsThin(c),
    ) ?? check.crawlers.find(readsThin);
  if (!bot) throw new Error('No crawler reads that template thin');

  const change = d.changes.find(
    (c) => c.site_id === site.id && c.subject === 'crawler_access' && c.kind === 'opened' && c.ua,
  );
  if (!change) throw new Error('The example site has no crawler-access change');
  const zone = d.accounts.find((a) => a.id === site.account_id)?.timezone ?? 'UTC';

  return {
    example: {
      domain: site.host,
      duration: duration(end.elapsed_ms),
      pagesCrawled: end.pages_crawled,
      pagesTotal: end.pages_estimated,
      links: end.links_found,
      grades: [
        {
          label: 'Technical SEO',
          letter: t.grade,
          score: t.score,
          tone: toneOf(t.grade),
          withheld: false,
          summary: seoShortSummary(check, fixes, isOpen),
        },
        {
          label: 'AI readability',
          letter: ai.grade,
          score: ai.total,
          tone: toneOf(ai.grade),
          withheld: false,
          summary: aiShortSummary(check),
        },
      ],
      map,
      mapLabel: mapLabel(map.nodes, false),
    },
    crawlers: {
      productHeader: `${capitalise(productNoun.pages)} · ${product.pages}`,
      rows: HOME_CRAWLERS.map((ua) => {
        const c = crawlerOf(check, ua);
        return {
          crawler: ua,
          homepage: cell(c, '/'),
          products: cell(c, product.template_key),
          text: c.text_share === null ? 'not measured' : `${percent(c.text_share)}%`,
          obstacle: obstacle(c, productNoun.adjective),
        };
      }),
    },
    withoutJs: {
      path: new URL(page.url).pathname,
      browserWords: page.without_js.rendered_words,
      bot: bot.ua,
      botWords: page.without_js.raw_words,
      share: percent(page.without_js.raw_words / page.without_js.rendered_words),
      templatePages: pageTemplate.pages,
      templateNoun: templateNoun(pageTemplate.label).adjective,
    },
    alert: {
      title: change.summary.replace(new RegExp(` on ${site.host.replace(/\./g, '\\.')}$`), ''),
      time: weekdayTime(change.detected_at, zone),
      domain: site.host,
      changedFile: change.where,
      changedAt: change.cause?.changed_at ? weekdayTime(change.cause.changed_at, zone) : null,
      pagesAffected: change.pages_affected,
      diff: { removed: change.cause?.diff?.removed ?? [], added: change.cause?.diff?.added ?? [] },
    },
  };
}
