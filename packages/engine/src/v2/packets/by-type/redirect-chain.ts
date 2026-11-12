/**
 * redirect_chain: a link target that answers only after REDIRECT_CHAIN_MIN_HOPS redirects or more, or
 * whose redirects loop (detectors/redirect-chains.ts). The record's subject is the target as the
 * links spell it; its affected pages are the pages that link to it, where the fix is made.
 *
 * Two shapes. When the chain ends at a page answering 200 at another URL, the links are pointed at
 * that URL, and verify reads a linking page: it must link to the final URL and no longer to the
 * redirecting one. When there is no such page (the redirects loop, or the crawl stopped on a
 * redirect), there is nowhere to point a link, so the change is to the redirect rules and verify
 * follows the URL with at most one redirect allowed.
 */
import {
  ANCHOR_HREFS,
  command,
  fetchOf,
  hrefForms,
  movedTo,
  part,
  spelled,
} from '../html-checks.js';
import { pagesShown, plural, rowOf, subjectOf } from '../structure.js';
import { code, count, line, type Line } from '../text.js';
import type { PacketEntry, PacketFacts, RecordOf } from '../types.js';

type Fix = RecordOf<'redirect_chain'>;

/** Where the chain ends, as the server wrote it, when that is a page at another URL; else null. */
function landing(fix: Fix, facts: PacketFacts): string | null {
  const target = subjectOf(fix);
  const row = rowOf(facts, target);
  if (fix.conditions.includes('redirect_loop') || row.status_code !== 200) return null;
  if (row.final_url === null || spelled(row.final_url) === target) return null;
  return row.final_url;
}

function hopLines(fix: Fix, facts: PacketFacts): Line[] {
  const hops = rowOf(facts, subjectOf(fix)).redirect?.hops ?? [];
  return hops.map((hop, i) =>
    hop.location === null
      ? line`Redirect ${count(i + 1)}: ${code(hop.from)} answers ${count(hop.status)} with a Location the crawl did not keep.`
      : line`Redirect ${count(i + 1)}: ${code(hop.from)} answers ${count(hop.status)} with Location ${code(hop.location)}.`,
  );
}

export const redirectChain: PacketEntry<'redirect_chain'> = {
  kind: 'builder',
  context: (fix, facts) => {
    const target = subjectOf(fix);
    const row = rowOf(facts, target);
    const linking = fix.affected_urls.length;
    const hops = fix.measured ?? row.redirect?.hops.length ?? 0;
    const pages = plural(linking, 'page links', 'pages link');
    const final = landing(fix, facts);
    return [
      fix.conditions.includes('redirect_loop')
        ? line`${count(linking)} ${pages} to ${code(target)}, whose redirects loop: after ${count(hops)} ${plural(hops, 'redirect', 'redirects')} a Location names a URL the chain had already requested.`
        : line`${count(linking)} ${pages} to ${code(target)}, which answers only after ${count(hops)} redirects.`,
      ...hopLines(fix, facts),
      final !== null
        ? line`The chain ends at ${code(final)}, which answers 200.`
        : fix.conditions.includes('redirect_loop')
          ? line`The chain reaches no page.`
          : line`The crawl reached no page at another URL: its request ended with status ${count(row.status_code)}.`,
    ];
  },
  generic: (fix, facts) => {
    const target = subjectOf(fix);
    const final = landing(fix, facts);
    const linking = pagesShown(fix.affected_urls);
    if (final === null) {
      return {
        change: [
          line`Fix the redirect rules so that a request for ${code(target)} reaches a page that answers 200 through at most one redirect.`,
          line`Or, where the page the links should lead to is known, point the links on ${linking} straight at it.`,
        ],
        keep: [line`Keep the pages that link to ${code(target)} otherwise as they are.`],
      };
    }
    return {
      change: [
        line`On ${linking}, change the href of each link to ${code(target)} so that it reads ${code(final)}.`,
        line`A link in a shared header, footer or template is one edit for every page it appears on.`,
        line`Separately, if you control the redirect rules, send ${code(target)} to ${code(final)} in one response. The links are what this fix measures.`,
      ],
      keep: [
        line`Keep the redirect from ${code(target)}: links on other sites and bookmarks still arrive there.`,
      ],
    };
  },
  stacks: {},
  verify: (fix, facts) => {
    const target = subjectOf(fix);
    const final = landing(fix, facts);
    const [first] = fix.affected_urls;
    if (final === null || first === undefined) {
      const fetch = fetchOf(facts, [target], part` -f -o /dev/null -L --max-redirs 1`);
      return {
        command: command(fetch.fragment),
        expect: line`Exit status 0 once ${code(target)} reaches a page that answers below 400 through at most one redirect. Today the crawl recorded ${count(fix.measured ?? 0)} redirects and no page at the end of them.`,
        ua: fetch.ua,
      };
    }
    const fetch = fetchOf(facts, [first]);
    const linking = fix.affected_urls.length;
    return {
      command: command(fetch.fragment, ANCHOR_HREFS, movedTo(hrefForms(target), hrefForms(final))),
      expect:
        linking === 1
          ? line`Exit status 0 once ${code(first)} links to ${code(final)} and no longer to ${code(target)} (an <a> href in full or from the root, in quotes). Today it links to ${code(target)}.`
          : line`Exit status 0 once ${code(first)} links to ${code(final)} and no longer to ${code(target)} (an <a> href in full or from the root, in quotes). Today it links to ${code(target)}. The command reads the first of the ${count(linking)} linking pages: run it for each.`,
      ua: fetch.ua,
    };
  },
};
