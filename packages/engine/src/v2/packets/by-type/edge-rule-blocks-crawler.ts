/**
 * The packet for a crawler refused by a rule that matches its user agent.
 *
 * Rendered from the access record and the worker rows it names (`evidence.access_test_ids`): the
 * crawler, the pages refused of the pages judged, the status of each refused request, the cause the
 * rows name, and the identity served on the same page. The audit does not see which product holds the
 * rule, so the change names none unless the check's stack recorded the edge vendor. Cloudflare is the
 * vendor build/record.ts `edgeOf` records, and its steps rest on the pages in `EDGE_VENDOR_SOURCES`.
 *
 * Cloudflare's page for error 1020 says which rules answer with it, so a record whose rows name that
 * cause gets the steps that page supports and no other.
 *
 * Verify: the first affected page, requested at the address the crawl read it at (served-at.ts
 * `readAt`) with the crawler's user agent, must answer 200 without a header of MITIGATION, the
 * response headers the crawl worker reads a challenge from. A redirect is not followed, so a rule
 * that redirects the crawler to a challenge does not pass. The body is not read: `expect` says so.
 *
 * The readable command above it makes the same request and prints the status alone: what the audit's
 * row for the page holds today, and 200 once the crawler is served.
 */
import type { AccessCause, AccessTest } from '@crawlmouse/types/v2';
import type { AccessDetection } from '../../access/types.js';
import { CRAWLER_REGISTRY_V2 } from '../../crawler-registry.js';
import { userAgentOf, verifyCrawler } from '../crawler.js';
import { readAt, servedAt } from '../served-at.js';
import { sh, url, word } from '../shell.js';
import { code, count, line, list, ours, type Line } from '../text.js';
import type { DocSource, PacketEntry, PacketFacts } from '../types.js';

/** The affected pages a context line shows before it counts the rest. */
export const PAGES_SHOWN = 5;
/** The response headers a context line shows before it counts the rest. */
const SIGNATURES_SHOWN = 4;

/** The edge vendor whose steps are written, as build/record.ts names it. */
const CLOUDFLARE = 'Cloudflare';

const READ = '2026-11-12';

/** Cloudflare's own pages behind the Cloudflare steps of the change. */
export const EDGE_VENDOR_SOURCES: readonly DocSource[] = [
  {
    title: 'Error 1020',
    url: 'https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1020/',
    read: READ,
    supports:
      'error 1020 is returned when a security rule with a Block action and no custom response matched; API Shield schema validation and JWT validation are its examples; requests blocked by WAF custom rules or WAF managed rules do not get it; the Security Events log (Security > Analytics, Events tab) shows which security feature and rule blocked the request',
  },
  {
    title: 'Custom rules',
    url: 'https://developers.cloudflare.com/waf/custom-rules/',
    read: READ,
    supports: 'custom rules are evaluated in order and a Block stops the evaluation',
  },
  {
    title: 'Create a custom rule in the dashboard',
    url: 'https://developers.cloudflare.com/waf/custom-rules/create-dashboard/',
    read: READ,
    supports: 'custom rules are on the Security rules page',
  },
  {
    title: 'Manage AI crawlers',
    url: 'https://developers.cloudflare.com/ai-crawl-control/features/manage-ai-crawlers/',
    read: READ,
    supports:
      'AI Crawl Control: Allow or Block per crawler, in the Actions column of its row; a Block is enforced by a WAF custom rule the system creates or updates on the zone',
  },
  {
    title: 'AI Crawler and Agent access policies',
    url: 'https://developers.cloudflare.com/bots/additional-configurations/block-ai-bots/',
    read: READ,
    supports:
      'Security > Settings, filter by Bot traffic, AI Crawler and Agent access policies: an action per behaviour (Search, Agent, Training); Block applies to matching requests across the zone',
  },
  {
    title: 'Bot Fight Mode',
    url: 'https://developers.cloudflare.com/bots/get-started/bot-fight-mode/',
    read: READ,
    supports:
      'Bot Fight Mode issues challenges, labelled Bot Fight Mode in the Service field of a security event; it cannot be bypassed or skipped with WAF custom rules or Page Rules; Super Bot Fight Mode supports Skip rules',
  },
];

/** Each cause a row can name, in words: a cause the contract adds does not compile without its own. */
const CAUSE_TEXT: Readonly<Record<AccessCause, string>> = {
  cloudflare_1020: 'Cloudflare’s error 1020',
  bot_fight_mode: 'a Bot Fight Mode challenge',
  client_rendered_template: 'a template whose text is added in the browser',
  robots_txt_disallow: 'a Disallow rule in robots.txt',
  automation_challenge: 'a challenge the edge serves to automated requests of any user agent',
  rate_limit_429: 'a rate limit (status 429)',
  pay_per_crawl_402: 'a request for payment to crawl (status 402)',
  cross_host_redirect: 'a redirect to another host',
  verified_bot_only: 'a rule that admits the crawler only from its verified addresses',
};

/**
 * The response headers that mark a challenge, and the value each carries, in lower case: the crawl
 * worker's own list (packages/worker/src/verdict/response.ts MITIGATION_HEADERS), which the test
 * beside this file holds this one to.
 */
export const MITIGATION: ReadonlyArray<readonly [header: string, contains: string]> = [
  ['cf-mitigated', 'challenge'],
  ['x-vercel-mitigated', 'challenge'],
];

/**
 * The awk program of the verify command, over the response's header lines: exits 0 when the last
 * status line says 200 and no header of MITIGATION follows it. A server that sends `103 Early Hints`
 * prints that status line first, so each status line starts the verdict again.
 */
const SERVED_UNCHALLENGED =
  '/^HTTP\\//{ok=($2==200)}' +
  MITIGATION.map(([header, value]) => `tolower($0)~/^${header}:.*${value}/{ok=0}`).join('') +
  'END{exit !ok}';

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
const pagesOf = (n: number) => ours(n === 1 ? 'page' : 'pages');
const byOrder = <T extends string | number>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);

/** The record's refused pages, sorted: the order the context lists them in and verify takes the first of. */
const affectedPages = (record: AccessDetection): string[] =>
  [...record.affected_urls].sort(byOrder);

/** The worker rows the record names, in id order. */
function rowsOf(record: AccessDetection, facts: PacketFacts): AccessTest[] {
  const ids = new Set(record.evidence.access_test_ids);
  return facts.access_tests.filter((t) => ids.has(t.id)).sort((a, b) => byOrder(a.id, b.id));
}

function context(record: AccessDetection, facts: PacketFacts): Line[] {
  const crawler = code(record.crawler);
  const rows = rowsOf(record, facts);
  const lines: Line[] = [
    record.extent === null
      ? line`${crawler} was refused on ${count(record.affected_urls.length)} sampled ${pagesOf(record.affected_urls.length)} by a rule that matches its user agent.`
      : record.extent.of === 1
        ? line`${crawler} was refused on the 1 sampled page the audit judged it on, by a rule that matches its user agent.`
        : line`${crawler} was refused on ${count(record.extent.matching)} of the ${count(record.extent.of)} sampled pages the audit judged it on, by a rule that matches its user agent.`,
  ];

  const statuses = new Map<number, number>();
  for (const t of rows) {
    if (t.raw_status !== null) statuses.set(t.raw_status, (statuses.get(t.raw_status) ?? 0) + 1);
  }
  if (statuses.size > 0) {
    const shown = [...statuses]
      .sort(([a], [b]) => byOrder(a, b))
      .map(([status, n]) => ours(`${status} (${plural(n, 'request')})`));
    lines.push(line`Status of the refused requests: ${list(shown, shown.length, 'status')}.`);
  }

  const causes = [...new Set(record.evidence.causes)]
    .sort(byOrder)
    .map((c) => ours(CAUSE_TEXT[c]));
  lines.push(
    causes.length > 0
      ? line`Cause the responses name: ${list(causes, causes.length, 'cause')}.`
      : line`The responses name no product: the audit did not identify what holds the rule.`,
  );
  if (record.evidence.signatures.length > 0) {
    const shown = [...record.evidence.signatures].sort(byOrder).map((s) => code(s, 80));
    lines.push(line`Response headers: ${list(shown, SIGNATURES_SHOWN, 'header')}.`);
  }

  const witnessed = rows.flatMap((t) => (t.witness === null ? [] : [t.witness.ua]));
  if (witnessed.length > 0) {
    const identities = [...new Set(witnessed)].sort().map((ua) => code(ua, 64));
    const shown = list(identities, identities.length, 'identity');
    lines.push(
      rows.length === 1
        ? line`On that page another identity was served from the same address (${shown}), so the refusal is aimed at the user agent.`
        : line`On ${count(witnessed.length)} of those pages another identity was served from the same address (${shown}), so the refusal is aimed at the user agent.`,
    );
  }
  if (rows.length > 0 && rows.every((t) => t.tagged)) {
    lines.push(
      line`The audit sent this user agent with a Crawlmouse tag, from Crawlmouse’s address. What the operator’s own crawler gets is in the site’s logs.`,
    );
  }
  const pages = affectedPages(record).map((u) => code(servedAt(facts, u)));
  lines.push(
    line`${ours(pages.length === 1 ? 'Page' : 'Pages')} refused: ${list(pages, PAGES_SHOWN, 'page')}.`,
  );
  return lines;
}

/** The steps Cloudflare's page for error 1020 supports, for a record whose rows name that cause. */
function cloudflare1020Steps(record: AccessDetection): Line[] {
  const crawler = code(record.crawler);
  return [
    line`Cloudflare answered with error 1020. Cloudflare's page for that error says it is returned when a security rule with a Block action and no custom response matched the request, gives API Shield schema validation and JWT validation as examples, and says a request blocked by a WAF custom rule or a WAF managed rule does not get it.`,
    line`In the Cloudflare dashboard open Security > Analytics, Events tab, and find a refused request: the event shows which security feature and rule blocked it. Cloudflare's page does not list every feature that answers with error 1020, so the event is what names it.`,
    line`Update the configuration of that feature or rule so that it no longer blocks ${crawler}.`,
  ];
}

function cloudflareSteps(record: AccessDetection): Line[] {
  if (record.evidence.causes.includes('cloudflare_1020')) return cloudflare1020Steps(record);
  const crawler = code(record.crawler);
  return [
    line`In the Cloudflare dashboard open Security > Analytics, Events tab, and find a refused request: the event shows which security feature and rule acted on it.`,
    line`If it is a custom rule (Security rules page): change the rule's expression so it no longer matches ${crawler}. Custom rules are evaluated in order, and a Block stops the evaluation of later rules.`,
    line`If AI Crawl Control blocks it: in AI Crawl Control, select Allow in the Actions column of the row for ${crawler}. A Block there is enforced by a WAF custom rule Cloudflare creates on the zone.`,
    line`If an AI Crawler and Agent access policy blocks it (Security > Settings, filter by Bot traffic): the policy sets an action per behaviour (Search, Agent, Training), and Block applies across the zone. Change the action for the behaviour ${crawler} has.`,
    line`If the event's Service field says Bot Fight Mode: it cannot be bypassed or skipped with a WAF custom rule or a Page Rule. An exception for specific traffic needs Super Bot Fight Mode, which supports Skip rules.`,
  ];
}

function anyEdgeSteps(record: AccessDetection): Line[] {
  const crawler = code(record.crawler);
  return [
    line`Find the rule that refuses requests whose User-Agent header contains ${crawler}. It can be in the CDN or WAF, a bot-management product, the web server's configuration or the application's middleware.`,
    line`Remove ${crawler} from what the rule matches, or add an exception that serves it.`,
  ];
}

const OWNERS_CHOICE = ours(
  "The audit records what was refused, not what the site intends, and a block can be deliberate: the choice is the site owner's. The steps below apply if it should be served.",
);

/**
 * The first step for a crawler of any group: a block can be deliberate, and the record does not hold
 * the site's intent. What the crawler is for is the registry's `purpose`, where the registry lists it.
 */
function choice(record: AccessDetection): Line {
  const crawler = code(record.crawler);
  const entry = CRAWLER_REGISTRY_V2.find((e) => e.token === record.crawler);
  return entry === undefined
    ? line`Decide first whether ${crawler} should be let in. ${OWNERS_CHOICE}`
    : line`Decide first whether ${crawler} should be let in. What it is for: ${ours(entry.purpose)} ${OWNERS_CHOICE}`;
}

export const edgeRuleBlocksCrawler: PacketEntry<'edge_rule_blocks_crawler'> = {
  kind: 'builder',
  context,
  generic: (record, facts) => {
    const crawler = code(record.crawler);
    const steps =
      facts.stack.edge?.vendor === CLOUDFLARE ? cloudflareSteps(record) : anyEdgeSteps(record);
    return {
      change: [choice(record), ...steps, line`Deploy the rule change, then run the check below.`],
      keep: [
        line`Leave the rule's other clauses as they are: change only what matches ${crawler}.`,
        line`Keep robots.txt as the place that states which crawlers may read the site. This change does not edit it.`,
        line`Serve ${crawler} the same page a visitor gets, not a version made for crawlers.`,
      ],
    };
  },
  stacks: {},
  verify: (record, facts) => {
    const entry = verifyCrawler(facts, record.crawler);
    if (entry === null || entry.token !== record.crawler) {
      throw new Error('packets: an edge fix names a crawler the registry cannot request as');
    }
    const page = affectedPages(record)[0];
    if (page === undefined) throw new Error('packets: an edge fix names no affected page');
    const today = rowsOf(record, facts).find((t) => t.page_url === page)?.raw_status ?? null;
    const headers = list(
      MITIGATION.map(([header]) => ours(`\`${header}\``)),
      MITIGATION.length,
      'header',
    );
    const pass = ours(
      `Exits 0 when the page answers status 200 to this user agent with no challenge header (${headers.text}), and prints nothing. A redirect is not followed and does not pass. The command reads the status and those headers, not the body: a block page served with status 200 and none of those headers passes.`,
    );
    const agent = word(userAgentOf(entry));
    const address = url(readAt(facts, page));
    const crawler = code(record.crawler);
    return {
      command: sh`curl -sS -o /dev/null -D - -A ${agent} ${address} | awk ${word(SERVED_UNCHALLENGED)}`,
      see: {
        command: sh`curl -sS -o /dev/null -w ${word('%{http_code}\\n')} -A ${agent} ${address}`,
        today:
          today === null
            ? line`The audit recorded no status for its request for this page as ${crawler}.`
            : line`${ours(`\`${today}\``)}: the status the audit’s request for this page as ${crawler} was answered with.`,
        after: line`${ours('`200`')}. The exact check below also requires that no challenge header comes with it.`,
      },
      expect:
        today === null
          ? line`${pass}`
          : line`${pass} The audit's request for it was answered ${count(today)}.`,
      ua: entry.token,
    };
  },
};
