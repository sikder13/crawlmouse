/**
 * orphan_pages: a page no other crawled page links to (detectors/orphans.ts). The change is one link,
 * on the parent the audit suggests when it suggests one (build/grade.ts `suggestedParents`).
 *
 * Verify fetches the page the link goes on and looks for an `<a>` to the orphan. With no suggested
 * parent there is no such page to name: the command then requests the homepage, which holds no link
 * to the orphan today, and its `expect` tells the developer to put their own page in its place.
 *
 * A page no link reaches is also a deep page, so the same URL can carry a deep_pages fix. The two
 * packets name one page when they can (deep-pages.ts `linkFrom`): this one says how far the suggested
 * parent is from the homepage, and whether a link there settles the depth too.
 */
import { MAX_HEALTHY_DEPTH } from '../../detectors/thresholds.js';
import { command, fetchOf, linksTo } from '../html-checks.js';
import { servedAt } from '../served-at.js';
import { clicksFromHome, CRAWLABLE_LINK, plural, rowOf, subjectOf, titleOf } from '../structure.js';
import { code, count, line, type Line } from '../text.js';
import type { PacketEntry, PacketFacts } from '../types.js';

/** Whether a link on the suggested parent also brings the page within the depth the audit counts as healthy. */
function depthLine(facts: PacketFacts, parent: string): Line {
  const clicks = clicksFromHome(facts).get(parent);
  if (clicks === undefined) {
    return line`No path of links from the homepage reaches ${code(parent)} either, so with this link alone the page stays out of reach of the homepage: where the audit lists a deep-page fix for this URL, it names a page close enough for both.`;
  }
  return clicks < MAX_HEALTHY_DEPTH
    ? line`${code(parent)} is ${count(clicks)} ${plural(clicks, 'click', 'clicks')} from the homepage, so this link also puts the page within ${count(MAX_HEALTHY_DEPTH)}.`
    : line`${code(parent)} is ${count(clicks)} clicks from the homepage, so with this link alone the page is more than ${count(MAX_HEALTHY_DEPTH)} clicks deep: where the audit lists a deep-page fix for this URL, it names a page close enough for both.`;
}

export const orphanPages: PacketEntry<'orphan_pages'> = {
  kind: 'builder',
  context: (fix, facts) => {
    const url = subjectOf(fix);
    const others = [...facts.pages.values()].filter(
      (p) => p.status_code === 200 && p.url !== url,
    ).length;
    return [
      line`${code(servedAt(facts, url))} has no link from another page: the crawl read ${count(others)} other ${plural(others, 'page', 'pages')} that answered 200, and none links to it.`,
    ];
  },
  generic: (fix, facts) => {
    const url = subjectOf(fix);
    const page = rowOf(facts, url);
    const shown = code(servedAt(facts, url));
    const parent = page.suggested_parent_url;
    const title = titleOf(page);
    return {
      change: [
        ...(parent === null
          ? [
              line`Add a link to ${shown} on a page a visitor would reach it from: the listing page of its section, or a page on the same subject. The audit suggests no page for it.`,
            ]
          : [
              line`Add a link to ${shown} on ${code(servedAt(facts, parent))}. The audit ranks the content pages on this host that do not link here yet by the words their title, link texts and URL path share with this page's, and suggests the first; on a tie, the lower URL.`,
              depthLine(facts, parent),
            ]),
        CRAWLABLE_LINK,
        title === null
          ? line`Give it link text that names the page, not a stock phrase such as "read more".`
          : line`Give it link text that names the page. Its title, as a starting point: ${code(title)}.`,
      ],
      keep: [line`Keep the page at ${shown}: the fix is a link to it, not a move or a redirect.`],
    };
  },
  stacks: {},
  verify: (fix, facts) => {
    const url = subjectOf(fix);
    const shown = code(servedAt(facts, url));
    const parent = rowOf(facts, url).suggested_parent_url;
    const on = parent ?? facts.homepage_url;
    const fetch = fetchOf(facts, [on]);
    return {
      command: command(fetch.fragment, linksTo(servedAt(facts, on), [url])),
      expect:
        parent === null
          ? line`Exit status 0 once the page requested holds an <a> whose href is ${shown}, in full or from the root. The audit suggests no parent, so the command requests the homepage: put the URL of the page you added the link to in its place. Today no crawled page holds such a link.`
          : line`Exit status 0 once ${code(servedAt(facts, parent))} holds an <a> whose href is ${shown}, in full or from the root. Today no crawled page holds such a link.`,
      ua: fetch.ua,
    };
  },
};
