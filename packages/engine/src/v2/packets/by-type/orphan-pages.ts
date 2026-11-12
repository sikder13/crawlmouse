/**
 * orphan_pages: a page no other crawled page links to (detectors/orphans.ts). The change is one link,
 * on the parent the audit suggests when it suggests one (build/grade.ts `suggestedParents`).
 *
 * Verify fetches the page the link goes on and looks for an `<a>` to the orphan. With no suggested
 * parent there is no such page to name: the command then requests the homepage, which holds no link
 * to the orphan today, and its `expect` tells the developer to put their own page in its place.
 */
import { ANCHOR_HREFS, anyOf, command, fetchOf, hrefForms } from '../html-checks.js';
import { CRAWLABLE_LINK, plural, rowOf, subjectOf, titleOf } from '../structure.js';
import { code, count, line } from '../text.js';
import type { PacketEntry } from '../types.js';

export const orphanPages: PacketEntry<'orphan_pages'> = {
  kind: 'builder',
  context: (fix, facts) => {
    const url = subjectOf(fix);
    const others = [...facts.pages.values()].filter(
      (p) => p.status_code === 200 && p.url !== url,
    ).length;
    return [
      line`${code(url)} has no link from another page: the crawl read ${count(others)} other ${plural(others, 'page', 'pages')} that answered 200, and none links to it.`,
    ];
  },
  generic: (fix, facts) => {
    const url = subjectOf(fix);
    const page = rowOf(facts, url);
    const parent = page.suggested_parent_url;
    const title = titleOf(page);
    return {
      change: [
        parent === null
          ? line`Add a link to ${code(url)} on a page a visitor would reach it from: the listing page of its section, or a page on the same subject. The audit suggests no page for it.`
          : line`Add a link to ${code(url)} on ${code(parent)}. The audit suggests that page: of the pages that do not link here yet, its title, link text and URL are the closest match.`,
        CRAWLABLE_LINK,
        title === null
          ? line`Give it link text that names the page, not a stock phrase such as "read more".`
          : line`Give it link text that names the page. Its title, as a starting point: ${code(title)}.`,
      ],
      keep: [
        line`Keep the page at ${code(url)}: the fix is a link to it, not a move or a redirect.`,
      ],
    };
  },
  stacks: {},
  verify: (fix, facts) => {
    const url = subjectOf(fix);
    const parent = rowOf(facts, url).suggested_parent_url;
    const fetch = fetchOf(facts, [parent ?? facts.homepage_url]);
    return {
      command: command(fetch.fragment, ANCHOR_HREFS, anyOf(hrefForms(url))),
      expect:
        parent === null
          ? line`Exit status 0 once the page requested holds an <a> whose href is ${code(url)}, in full or from the root, in quotes. The audit suggests no parent, so the command requests the homepage: put the URL of the page you added the link to in its place. Today no crawled page holds such a link.`
          : line`Exit status 0 once ${code(parent)} holds an <a> whose href is ${code(url)}, in full or from the root, in quotes. Today no crawled page holds such a link.`,
      ua: fetch.ua,
    };
  },
};
