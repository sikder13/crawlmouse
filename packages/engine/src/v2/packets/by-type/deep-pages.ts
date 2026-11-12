/**
 * deep_pages: a page more than MAX_HEALTHY_DEPTH clicks from the homepage, or one no path of links
 * reaches (detectors/deep-pages.ts). The change is one link from a page close to the homepage.
 *
 * Which page the packet names (`linkFrom`). The fix's estimate links the page from `shallowParent`
 * (grade/effects.ts), over the check's pages and its links as the grade files them. A page that is
 * also an orphan carries an orphan_pages fix, whose packet names the parent the audit suggests for
 * it (orphan-pages.ts). When that parent is itself close enough to the homepage, this packet names it
 * too, so that the two fixes for one URL ask for one link; otherwise it names the estimate's page and
 * says why the suggested parent does not settle the depth. The estimate is not changed by the choice.
 *
 * The estimate applies fixes in rank order, so a fix ranked above this one can have added links
 * before it; the estimate's page here is the one chosen on the links the crawl recorded.
 */
import { MAX_HEALTHY_DEPTH } from '../../detectors/thresholds.js';
import { shallowParent } from '../../grade/effects.js';
import { command, fetchOf, linksTo } from '../html-checks.js';
import { servedAt } from '../served-at.js';
import { clicksFromHome, CRAWLABLE_LINK, filedLinks, pagesShown, subjectOf } from '../structure.js';
import { code, count, line, type Line } from '../text.js';
import type { PacketEntry, PacketFacts } from '../types.js';

/** A check has one shallow page for all its deep pages, so it is chosen once per check's facts. */
const parents = new WeakMap<PacketFacts, string>();

interface LinkFrom {
  /** The page the packet puts the link on. */
  parent: string;
  /** The page the estimate links from. */
  estimate: string;
  /** The parent the orphan fix for this URL suggests; null when there is none. */
  suggested: string | null;
}

function linkFrom(facts: PacketFacts, url: string): LinkFrom {
  const edges = filedLinks(facts);
  const estimate =
    parents.get(facts) ??
    shallowParent({ pages: [...facts.pages.values()], edges, homepage_url: facts.homepage_url });
  parents.set(facts, estimate);
  const suggested = facts.pages.get(url)?.suggested_parent_url ?? null;
  const clicks = suggested === null ? undefined : clicksFromHome(facts).get(suggested);
  const parent = clicks !== undefined && clicks < MAX_HEALTHY_DEPTH ? suggested! : estimate;
  if (edges.some((e) => e.from_url === parent && e.to_url === url)) {
    // such a page would be within MAX_HEALTHY_DEPTH clicks, and no deep page
    throw new Error('packets: the page a deep_pages packet links from already links to the page');
  }
  return { parent, estimate, suggested };
}

/** Why this page, in the words the choice was made on. */
function whyThere(from: LinkFrom, facts: PacketFacts): Line[] {
  const parent = code(servedAt(facts, from.parent));
  if (from.suggested === null) {
    return [
      line`On the links as crawled, the estimate for this fix puts the link on ${parent}, a page that close. Another page as close does as well: pick the one a visitor would look on.`,
    ];
  }
  if (from.parent === from.suggested) {
    return [
      line`No other page links to this one, and the audit's fix for that suggests ${parent}, a page that close: one link there settles both. The estimate for this fix was computed with the link on ${code(servedAt(facts, from.estimate))}; any page as close does as well.`,
    ];
  }
  return [
    line`On the links as crawled, the estimate for this fix puts the link on ${parent}, a page that close. Another page as close does as well: pick the one a visitor would look on.`,
    line`No other page links to this one, and the audit's fix for that suggests ${code(servedAt(facts, from.suggested))}, which is not that close to the homepage: a link there alone leaves the page deep, and a link on ${parent} settles both.`,
  ];
}

export const deepPages: PacketEntry<'deep_pages'> = {
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
    const { parent } = linkFrom(facts, url);
    const fetch = fetchOf(facts, [parent]);
    const on = servedAt(facts, parent);
    return {
      command: command(fetch.fragment, linksTo(on, [url])),
      expect: line`Exit status 0 once ${code(on)} holds an <a> whose href is ${code(servedAt(facts, url))}, in full or from the root; today it holds none. If you put the link on another page, request that page instead. The command proves the link; the click depth is measured again on the next check.`,
      ua: fetch.ua,
    };
  },
};
