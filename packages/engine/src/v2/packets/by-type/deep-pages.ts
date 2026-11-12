/**
 * deep_pages: a page more than MAX_HEALTHY_DEPTH clicks from the homepage, or one no path of links
 * reaches (detectors/deep-pages.ts). The change is one link from a page close to the homepage.
 *
 * Which page the packet names (`linkFrom`), the first of these that is within MAX_HEALTHY_DEPTH − 1
 * clicks on the detector's own graph (structure.ts `graphLinks`) and holds no link to the page in
 * the crawl's record (`holdsLink`):
 *   1. the parent the orphan fix for the same URL suggests (orphan-pages.ts), so that the two fixes
 *      for one URL ask for one link;
 *   2. the page the fix's estimate links from, `shallowParent` (grade/effects.ts), over the links as
 *      the grade files them;
 *   3. the next page that close: the deepest such, then the lowest URL, which is the estimate's own
 *      order.
 * The estimate is not changed by the choice. Its page can fail the test: the grade files a link
 * recorded from a page that did not answer 200, the detector's graph leaves it out, so the estimate's
 * page can be one the detector does not count as close, or one that links to the page already; and a
 * page whose request ended on another crawled page is read there, where that page's links are. A
 * command that named such a page would pass before the fix.
 *
 * When no page passes the test (`certain` false) the packet names no page to request: a command
 * that requested the homepage would pass before the fix. Its command reads the address from a shell
 * variable the developer sets to the page they chose (html-checks.ts `fetchOfChosen`), and as
 * written, with the variable unset, it stops with an error and exits non-zero. That case takes a
 * homepage whose request ended on another crawled page that links to the deep page: to a visitor the
 * page is then one click away, and the depth the record holds is the filing's, not the site's.
 *
 * The estimate applies fixes in rank order, so a fix ranked above this one can have added links
 * before it; the estimate's page here is the one chosen on the links the crawl recorded.
 */
import { MAX_HEALTHY_DEPTH } from '../../detectors/thresholds.js';
import { shallowParent } from '../../grade/effects.js';
import { isGraded } from '../../grade/technical-seo.js';
import { CHOSEN_PAGE, command, fetchOf, fetchOfChosen, holds, linksTo } from '../html-checks.js';
import { servedAt } from '../served-at.js';
import {
  addressesOf,
  clicksFromHome,
  code,
  CRAWLABLE_LINK,
  filedLinks,
  fitting,
  holdsLink,
  MARKER_LIMIT,
  pagesShown,
  pathOf,
  pathWords,
  phrase,
  plural,
  readShown,
  seeTags,
  subjectOf,
  TAGS,
} from '../structure.js';
import { count, line, ours, type Line } from '../text.js';
import type { PacketEntry, PacketFacts } from '../types.js';

/** A check has one shallow page for all its deep pages, so it is chosen once per check's facts. */
const parents = new WeakMap<PacketFacts, string>();
/** The pages close to the homepage, in the estimate's order, once per check's facts. */
const closest = new WeakMap<PacketFacts, string[]>();

interface LinkFrom {
  /** The page the packet puts the link on. */
  parent: string;
  /** The page the estimate links from. */
  estimate: string;
  /** The parent the orphan fix for this URL suggests; null when there is none. */
  suggested: string | null;
  /** Whether the record shows `parent` close to the homepage and without a link to the page. */
  certain: boolean;
}

/** The pages within MAX_HEALTHY_DEPTH − 1 clicks of the homepage: the deepest first, then by URL. */
function closePages(facts: PacketFacts): string[] {
  const known = closest.get(facts);
  if (known !== undefined) return known;
  const clicks = clicksFromHome(facts);
  const pages = [...clicks]
    .filter(([url, depth]) => {
      const row = facts.pages.get(url);
      const counted = row !== undefined && (isGraded(row) || url === facts.homepage_url);
      return counted && row.status_code === 200 && depth < MAX_HEALTHY_DEPTH;
    })
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    .map(([url]) => url);
  closest.set(facts, pages);
  return pages;
}

function linkFrom(facts: PacketFacts, url: string): LinkFrom {
  const estimate =
    parents.get(facts) ??
    shallowParent({
      pages: [...facts.pages.values()],
      edges: filedLinks(facts),
      homepage_url: facts.homepage_url,
    });
  parents.set(facts, estimate);
  const suggested = facts.pages.get(url)?.suggested_parent_url ?? null;
  const close = closePages(facts);
  const fits = (page: string) => page !== url && !holdsLink(facts, page, url);
  const parent =
    [suggested, estimate].find(
      (page): page is string => page !== null && close.includes(page) && fits(page),
    ) ?? close.find(fits);
  return parent === undefined
    ? { parent: facts.homepage_url, estimate, suggested, certain: false }
    : { parent, estimate, suggested, certain: true };
}

/** Why this page, in the words the choice was made on. */
function whyThere(from: LinkFrom, facts: PacketFacts): Line[] {
  const parent = code(servedAt(facts, from.parent));
  if (!from.certain) {
    return [
      line`The crawl's record names no page that close without a link here already: ${parent} was read at an address the crawl also holds as another page, and the links found there include this one. Put the link on a page a visitor reaches within ${count(MAX_HEALTHY_DEPTH - 1)} clicks of the homepage.`,
    ];
  }
  const suggestion: Line[] =
    from.suggested === null || closePages(facts).includes(from.suggested)
      ? []
      : [
          line`No other page links to this one, and the audit's fix for that suggests ${code(servedAt(facts, from.suggested))}, which is not that close to the homepage: a link there alone leaves the page deep, and a link on ${parent} settles both.`,
        ];
  if (from.parent === from.suggested) {
    return [
      line`No other page links to this one, and the audit's fix for that suggests ${parent}, a page that close: one link there settles both. The estimate for this fix was computed with the link on ${code(servedAt(facts, from.estimate))}; any page as close does as well.`,
    ];
  }
  if (from.parent === from.estimate) {
    return [
      line`On the links as crawled, the estimate for this fix puts the link on ${parent}, a page that close. Another page as close does as well: pick the one a visitor would look on.`,
      ...suggestion,
    ];
  }
  return [
    line`${parent} is that close and holds no link to this page in the crawl's record. Another page as close does as well: pick the one a visitor would look on.`,
    ...suggestion,
  ];
}

export const deepPages: PacketEntry<'deep_pages'> = fitting({
  kind: 'builder',
  context: (fix, facts) => {
    const url = subjectOf(fix);
    const shown = code(servedAt(facts, url));
    const home = facts.homepage_url;
    const between = fix.evidence.pages.filter((p) => p !== url && p !== home);
    return [
      fix.measured === null
        ? line`No path of links from the homepage ${code(home)} reaches ${shown}; the audit counts more than ${count(MAX_HEALTHY_DEPTH)} clicks as deep.`
        : line`${shown} is ${count(fix.measured)} clicks from the homepage ${code(home)}; the audit counts more than ${count(MAX_HEALTHY_DEPTH)} as deep.`,
      ...(between.length === 0
        ? []
        : [
            line`The shortest path the crawl found passes through, in URL order: ${pagesShown(between)}.`,
          ]),
    ];
  },
  generic: (fix, facts) => {
    const url = subjectOf(fix);
    const shown = code(servedAt(facts, url));
    return {
      change: [
        line`Add a link to ${shown} on a page at most ${count(MAX_HEALTHY_DEPTH - 1)} clicks from the homepage, so that it lands within ${count(MAX_HEALTHY_DEPTH)}.`,
        ...whyThere(linkFrom(facts, url), facts),
        CRAWLABLE_LINK,
      ],
      keep: [
        line`Keep the page at ${shown} and the links it has: the fix adds a shorter path, it moves nothing.`,
      ],
    };
  },
  stacks: {},
  verify: (fix, facts) => {
    const url = subjectOf(fix);
    const shown = code(servedAt(facts, url));
    const { parent, certain } = linkFrom(facts, url);
    const on = readShown(facts, parent);
    const link = linksTo(addressesOf(facts, url));
    if (!certain) {
      // no page to request that the record shows without the link: the developer names theirs
      const chosen = fetchOfChosen(facts);
      const depth =
        fix.measured === null
          ? phrase`The crawl found no path of links from the homepage to ${shown}.`
          : phrase`The crawl counted ${shown} ${count(fix.measured)} ${plural(fix.measured, 'click', 'clicks')} from the homepage.`;
      return {
        command: command(holds(chosen, link)),
        expect: line`As written the command stops with an error and exits non-zero: the audit could not name a page to link from, since the record holds no page close to the homepage without a link to ${shown}. Set the shell variable ${ours(CHOSEN_PAGE)} to the URL of the page you added the link to, then run it: exit status 0 once that page holds an <a> whose href is ${shown}, however the URL is written. The click depth is measured again on the next check. ${MARKER_LIMIT}`,
        ua: chosen.ua,
        see: {
          command: seeTags(facts, [parent], TAGS.a, pathWords(url)),
          today: line`The <a> tags at ${on} that hold ${code(pathOf(url))}. ${depth} It read that address as another page too, and the links it found there include this one, so a visitor may be closer than the record says.`,
          after: line`The same lines: the link you add goes on a page you choose, and the exact check reads that page.`,
        },
      };
    }
    const fetch = fetchOf(facts, [parent]);
    return {
      command: command(holds(fetch, link)),
      expect: line`Exit status 0 once ${on} holds an <a> whose href is ${shown}, however the URL is written; today it holds none. If you put the link on another page, request that page instead. The command proves the link; the click depth is measured again on the next check. ${MARKER_LIMIT}`,
      ua: fetch.ua,
      see: {
        command: seeTags(facts, [parent], TAGS.a, pathWords(url)),
        today: line`Nothing: the crawl found no link to ${shown} on that page.`,
        after: line`The <a> tag you added: a line that holds ${code(pathOf(url))}. A link that spells the path another way is not printed; the exact check reads it.`,
      },
    };
  },
});
