/**
 * deep_pages: a page more than MAX_HEALTHY_DEPTH clicks from the homepage, or one no path of links
 * reaches (detectors/deep-pages.ts). The change is one link from a page close to the homepage.
 *
 * The packet names the page the fix's estimate links it from: `shallowParent` (grade/effects.ts) over
 * the check's pages and its links as the grade files them. The estimate applies fixes in rank order,
 * so a fix ranked above this one can have added links before it; the packet's page is the one chosen
 * on the links the crawl recorded.
 */
import { MAX_HEALTHY_DEPTH } from '../../detectors/thresholds.js';
import { shallowParent } from '../../grade/effects.js';
import { ANCHOR_HREFS, anyOf, command, fetchOf, hrefForms } from '../html-checks.js';
import { CRAWLABLE_LINK, filedLinks, pagesShown, subjectOf } from '../structure.js';
import { code, count, line } from '../text.js';
import type { PacketEntry, PacketFacts } from '../types.js';

/** A check has one shallow page for all its deep pages, so it is chosen once per check's facts. */
const parents = new WeakMap<PacketFacts, string>();

/** The page the estimate links a deep page from, and whether the recorded links already hold that link. */
function parentOf(facts: PacketFacts, url: string): { parent: string; linked: boolean } {
  const edges = filedLinks(facts);
  const parent =
    parents.get(facts) ??
    shallowParent({ pages: [...facts.pages.values()], edges, homepage_url: facts.homepage_url });
  parents.set(facts, parent);
  return { parent, linked: edges.some((e) => e.from_url === parent && e.to_url === url) };
}

export const deepPages: PacketEntry<'deep_pages'> = {
  kind: 'builder',
  context: (fix, facts) => {
    const url = subjectOf(fix);
    const home = facts.homepage_url;
    const between = fix.evidence.pages.filter((p) => p !== url && p !== home);
    return [
      fix.measured === null
        ? line`No path of links from the homepage ${code(home)} reaches ${code(url)}; the audit counts more than ${count(MAX_HEALTHY_DEPTH)} clicks as deep.`
        : line`${code(url)} is ${count(fix.measured)} clicks from the homepage ${code(home)}; the audit counts more than ${count(MAX_HEALTHY_DEPTH)} as deep.`,
      ...(between.length === 0
        ? []
        : [
            line`The shortest path the crawl found passes through, in URL order: ${pagesShown(between)}.`,
          ]),
    ];
  },
  generic: (fix, facts) => {
    const url = subjectOf(fix);
    const { parent } = parentOf(facts, url);
    return {
      change: [
        line`Add a link to ${code(url)} on a page at most ${count(MAX_HEALTHY_DEPTH - 1)} clicks from the homepage, so that it lands within ${count(MAX_HEALTHY_DEPTH)}.`,
        line`On the links as crawled, the estimate for this fix puts the link on ${code(parent)}, a page that close. Another page as close does as well: pick the one a visitor would look on.`,
        CRAWLABLE_LINK,
      ],
      keep: [
        line`Keep the page at ${code(url)} and the links it has: the fix adds a shorter path, it moves nothing.`,
      ],
    };
  },
  stacks: {},
  verify: (fix, facts) => {
    const url = subjectOf(fix);
    const { parent, linked } = parentOf(facts, url);
    const fetch = fetchOf(facts, [parent]);
    return {
      command: command(fetch.fragment, ANCHOR_HREFS, anyOf(hrefForms(url))),
      expect: linked
        ? line`Exit status 0 once ${code(parent)} holds an <a> whose href is ${code(url)}, in full or from the root, in quotes. If you put the link on another page, request that page instead. The command proves the link; the click depth is measured again on the next check.`
        : line`Exit status 0 once ${code(parent)} holds an <a> whose href is ${code(url)}, in full or from the root, in quotes; today it holds none. If you put the link on another page, request that page instead. The command proves the link; the click depth is measured again on the next check.`,
      ua: fetch.ua,
    };
  },
};
