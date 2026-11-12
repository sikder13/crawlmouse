/**
 * The packet for a crawler refused by a rule that matches its user agent.
 *
 * Rendered from the access record and the worker rows it names (`evidence.access_test_ids`): the
 * crawler, the pages refused of the pages judged, the status of each refused request, the cause the
 * rows name, and the identity served on the same page. The audit does not see which product holds the
 * rule, so the change names none unless the check's stack recorded the edge vendor. Cloudflare is the
 * vendor build/record.ts `edgeOf` records, and its steps rest on the pages in `EDGE_VENDOR_SOURCES`.
 *
 * Verify: the first affected page, requested with the crawler's user agent, must answer 200. A
 * redirect is not followed, so a rule that redirects the crawler to a challenge does not pass.
 */
import type { AccessCause, AccessTest } from '@crawlmouse/types/v2';
import type { AccessDetection } from '../../access/types.js';
import { userAgentOf, verifyCrawler } from '../crawler.js';
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
      'error 1020 is a security rule with a Block action; the Security Events log (Security > Analytics, Events tab) names the feature and rule',
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
      'AI Crawl Control, Crawlers tab: Allow or Block per crawler; a Block is enforced by a WAF custom rule Cloudflare creates',
  },
  {
    title: 'AI Crawler and Agent access policies',
    url: 'https://developers.cloudflare.com/bots/additional-configurations/block-ai-bots/',
    read: READ,
    supports:
      'Security > Settings, Bot traffic: a policy per behaviour (Search, Agent, Training) can block across the zone',
  },
  {
    title: 'Bot Fight Mode',
    url: 'https://developers.cloudflare.com/bots/get-started/bot-fight-mode/',
    read: READ,
    supports:
      'Bot Fight Mode cannot be bypassed or skipped with WAF custom rules or Page Rules; Super Bot Fight Mode supports Skip rules',
  },
];

/** A cause the rows name, in words; a cause with no entry is shown as recorded. */
const CAUSE_TEXT: Readonly<Partial<Record<AccessCause, string>>> = {
  cloudflare_1020: 'Cloudflare’s error 1020',
};

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
const byOrder = <T extends string | number>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);

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
      ? line`${crawler} was refused on ${count(record.affected_urls.length)} sampled pages by a rule that matches its user agent.`
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

  const causes = [...new Set(record.evidence.causes)].map((c) =>
    Object.hasOwn(CAUSE_TEXT, c) ? ours(CAUSE_TEXT[c]!) : code(c),
  );
  lines.push(
    causes.length > 0
      ? line`Cause the responses name: ${list(causes, causes.length, 'cause')}.`
      : line`The responses name no product: the audit did not identify what holds the rule.`,
  );
  if (record.evidence.signatures.length > 0) {
    const shown = record.evidence.signatures.map((s) => code(s, 80));
    lines.push(line`Response headers: ${list(shown, SIGNATURES_SHOWN, 'header')}.`);
  }

  const witnessed = rows.flatMap((t) => (t.witness === null ? [] : [t.witness.ua]));
  if (witnessed.length > 0) {
    const identities = [...new Set(witnessed)].sort().map((ua) => code(ua, 64));
    lines.push(
      line`On ${count(witnessed.length)} of those pages another identity was served from the same address (${list(identities, identities.length, 'identity')}), so the refusal is aimed at the user agent.`,
    );
  }
  if (rows.length > 0 && rows.every((t) => t.tagged)) {
    lines.push(
      line`The audit sent this user agent with a Crawlmouse tag, from Crawlmouse’s address. What the operator’s own crawler gets is in the site’s logs.`,
    );
  }
  const pages = record.affected_urls.map((u) => code(u));
  lines.push(line`Pages refused: ${list(pages, PAGES_SHOWN, 'page')}.`);
  return lines;
}

function cloudflareSteps(record: AccessDetection): Line[] {
  const crawler = code(record.crawler);
  const events = line`In the Cloudflare dashboard open Security > Analytics, Events tab, and find a refused request: the event names the security feature and the rule that blocked it.`;
  return [
    ...(record.evidence.causes.includes('cloudflare_1020')
      ? [
          line`Cloudflare answered with error 1020: a security rule with a Block action matched the request.`,
        ]
      : []),
    events,
    line`If it is a custom rule (Security rules page): edit the rule's expression so it no longer matches ${crawler}. Custom rules are evaluated in order, and a Block stops the evaluation.`,
    line`If AI Crawl Control blocks it (AI Crawl Control, Crawlers tab): set the action for ${crawler} to Allow. A Block there is enforced by a WAF custom rule Cloudflare creates.`,
    line`If an AI Crawler and Agent access policy blocks it (Security > Settings, filter by Bot traffic): the policy is per behaviour (Search, Agent, Training) and blocks across the zone. Change the action for the behaviour ${crawler} has.`,
    line`If it is Bot Fight Mode: it cannot be bypassed or skipped with a WAF custom rule or a Page Rule. An exception for specific traffic needs Super Bot Fight Mode, which supports Skip rules.`,
  ];
}

function anyEdgeSteps(record: AccessDetection): Line[] {
  const crawler = code(record.crawler);
  return [
    line`Find the rule that refuses requests whose User-Agent header contains ${crawler}. It can be in the CDN or WAF, a bot-management product, the web server's configuration or the application's middleware.`,
    line`Remove ${crawler} from what the rule matches, or add an exception that serves it.`,
  ];
}

export const edgeRuleBlocksCrawler: PacketEntry<'edge_rule_blocks_crawler'> = {
  kind: 'builder',
  context,
  generic: (record, facts) => {
    const crawler = code(record.crawler);
    const choice =
      record.group === 'ai_training'
        ? [
            line`Decide first whether ${crawler} should be let in. It is a training crawler, and the audit records what was refused, not what the site intends: the choice is the site owner's. The steps below apply if it should be served.`,
          ]
        : [];
    const steps =
      facts.stack.edge?.vendor === CLOUDFLARE ? cloudflareSteps(record) : anyEdgeSteps(record);
    return {
      change: [...choice, ...steps, line`Deploy the rule change, then run the check below.`],
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
    const page = [...record.affected_urls].sort()[0];
    if (page === undefined) throw new Error('packets: an edge fix names no affected page');
    const today = rowsOf(record, facts).find((t) => t.page_url === page)?.raw_status ?? null;
    const pass = line`Exits 0 when the page answers status 200 to this user agent, and prints nothing. A redirect is not followed and does not pass.`;
    return {
      command: sh`curl -sS -o /dev/null -w '%{http_code}' -A ${word(userAgentOf(entry))} ${url(page)} | grep -qx 200`,
      expect:
        today === null
          ? pass
          : line`Exits 0 when the page answers status 200 to this user agent, and prints nothing. A redirect is not followed and does not pass. The audit's request for it was answered ${count(today)}.`,
      ua: entry.token,
    };
  },
};
