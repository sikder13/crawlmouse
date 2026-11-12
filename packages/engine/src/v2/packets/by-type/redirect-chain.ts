/**
 * redirect_chain: a link target that answers only after REDIRECT_CHAIN_MIN_HOPS redirects or more, or
 * whose redirects loop (detectors/redirect-chains.ts). The record's subject is the target as the
 * links spell it; its affected pages are the pages that link to it, where the fix is made.
 *
 * Where the chain ends decides the packet (`endOf`):
 *   - at a page answering 200 at another URL: the links are pointed at that URL, and verify reads a
 *     linking page, at the address its content was read at (served-at.ts `readAt`), which must link
 *     to the final URL and no longer to the redirecting one. When the programs read the two URLs as
 *     one (`/x~y` and `/x%7Ey`; html-checks.ts `sameInCommand`), a link cannot tell them apart, and
 *     verify follows the redirects as below;
 *   - at the same page under the address its server serves (the target with a trailing slash, say):
 *     a link cannot be told from the fixed one by the engine's spelling, so verify follows the URL
 *     the crawl requested with at most one redirect allowed, as it does when there is no page:
 *   - nowhere (the redirects loop, or the crawl stopped on a redirect): the change is to the
 *     redirect rules.
 */
import {
  command,
  fetchOf,
  holds,
  httpUrl,
  joined,
  linksTo,
  part,
  requestOf,
  sameInCommand,
  spelled,
  TIMED,
} from '../html-checks.js';
import { word } from '../shell.js';
import {
  addressesOf,
  code,
  fitting,
  MARKER_LIMIT,
  pagesShown,
  pathOf,
  pathWords,
  plural,
  readShown,
  rowOf,
  seeTags,
  subjectOf,
  TAGS,
  UNREAD_HREF,
} from '../structure.js';
import { count, line, ours, type Line } from '../text.js';
import type { PacketEntry, PacketFacts, RecordOf } from '../types.js';

type Fix = RecordOf<'redirect_chain'>;

type End =
  /** A page answering 200 at another URL; `final` as the server wrote it. */
  | { at: 'page'; final: string }
  /** The target itself, answering 200 at the address `final`. */
  | { at: 'same'; final: string }
  | { at: 'loop' }
  /** No page: the crawl's request ended with `status`, or at an address it did not keep. */
  | { at: 'none'; status: number };

function endOf(fix: Fix, facts: PacketFacts): End {
  const target = subjectOf(fix);
  const row = rowOf(facts, target);
  if (fix.conditions.includes('redirect_loop')) return { at: 'loop' };
  const landed = row.final_url === null ? null : httpUrl(row.final_url);
  if (row.status_code !== 200 || row.final_url === null || landed === null) {
    return { at: 'none', status: row.status_code };
  }
  return { at: landed === target ? 'same' : 'page', final: row.final_url };
}

/** The URL the crawl requested, as its first redirect records it; the record's spelling without one. */
const requested = (fix: Fix, facts: PacketFacts): string =>
  rowOf(facts, subjectOf(fix)).redirect?.hops[0]?.from ?? subjectOf(fix);

function hopLines(fix: Fix, facts: PacketFacts): Line[] {
  const hops = rowOf(facts, subjectOf(fix)).redirect?.hops ?? [];
  return hops.map((hop, i) =>
    hop.location === null
      ? line`Redirect ${count(i + 1)}: ${code(hop.from)} answers ${count(hop.status)} with a Location the crawl did not keep.`
      : line`Redirect ${count(i + 1)}: ${code(hop.from)} answers ${count(hop.status)} with Location ${code(hop.location)}.`,
  );
}

export const redirectChain: PacketEntry<'redirect_chain'> = fitting({
  kind: 'builder',
  context: (fix, facts) => {
    const target = code(subjectOf(fix));
    const row = rowOf(facts, subjectOf(fix));
    const linking = count(fix.affected_urls.length);
    const hops = fix.measured ?? row.redirect?.hops.length ?? 0;
    const pages = plural(fix.affected_urls.length, 'page links', 'pages link');
    const times = plural(hops, 'redirect', 'redirects');
    const end = endOf(fix, facts);
    const first: Record<End['at'], Line> = {
      loop: line`${linking} ${pages} to ${target}, whose redirects loop: after ${count(hops)} ${times} a Location names a URL the chain had already requested.`,
      none: line`${linking} ${pages} to ${target}, which was still redirecting after ${count(hops)} ${times}.`,
      page: line`${linking} ${pages} to ${target}, which answers only after ${count(hops)} ${times}.`,
      same: line`${linking} ${pages} to ${target}, which answers only after ${count(hops)} ${times}.`,
    };
    const last: Line =
      end.at === 'page'
        ? line`The chain ends at ${code(end.final)}, which answers 200.`
        : end.at === 'same'
          ? line`The chain ends at ${code(end.final)}, which answers 200: the same page, at the address its server serves it at.`
          : end.at === 'loop'
            ? line`The chain reaches no page.`
            : end.status === 200
              ? line`The crawl did not keep the address the chain ended at.`
              : line`The crawl reached no page: its request ended with status ${count(end.status)}.`;
    return [first[end.at], ...hopLines(fix, facts), last];
  },
  generic: (fix, facts) => {
    const target = code(subjectOf(fix));
    const end = endOf(fix, facts);
    const linking = pagesShown(fix.affected_urls);
    if (end.at === 'page') {
      return {
        change: [
          line`On ${linking}, change the href of each link to ${target} so that it reads ${code(end.final)}.`,
          line`A link in a shared header, footer or template is one edit for every page it appears on.`,
          line`Separately, if you control the redirect rules, send ${target} to ${code(end.final)} in one response. The links are what this fix measures.`,
        ],
        keep: [
          line`Keep the redirect from ${target}: links on other sites and bookmarks still arrive there.`,
        ],
      };
    }
    if (end.at === 'same') {
      return {
        change: [
          line`On ${linking}, write the href of each link to this page as ${code(end.final)}, character for character (scheme, host and the slash at its end), so that it needs no redirect.`,
          line`Or change the redirect rules so that the address the links use today reaches ${code(end.final)} in one response.`,
        ],
        keep: [line`Keep ${code(end.final)} answering 200 as it does.`],
      };
    }
    return {
      change: [
        line`Fix the redirect rules so that a request for ${target} reaches a page that answers 200 through at most one redirect.`,
        line`Or, where the page the links should lead to is known, point the links on ${linking} straight at it.`,
      ],
      keep: [line`Keep the pages that link to ${target} otherwise as they are.`],
    };
  },
  stacks: {},
  verify: (fix, facts) => {
    const target = subjectOf(fix);
    const end = endOf(fix, facts);
    const [first] = fix.affected_urls;
    const hops = fix.measured ?? 0;
    const redirects = plural(hops, 'redirect', 'redirects');
    // a link to the final URL that the programs read as a link to the redirecting one cannot be told
    // from the old link (html-checks.ts `sameInCommand`): the redirects are followed instead
    const told = end.at === 'page' && !sameInCommand(end.final, target);
    if (end.at !== 'page' || first === undefined || !told) {
      const from = requested(fix, facts);
      const fetch = requestOf(
        facts,
        [from],
        joined(part` -f -o /dev/null -L --max-redirs 1`, TIMED),
      );
      const counted = requestOf(
        facts,
        [from],
        joined(
          part` -o /dev/null -L --max-redirs 10`,
          TIMED,
          part` -w ${word('%{num_redirects} %{http_code}\\n')}`,
        ),
      );
      const answered = end.at === 'same' || end.at === 'page';
      return {
        command: command(fetch.fragment),
        expect: answered
          ? line`Exit status 0 once ${code(from)}, the address the crawl requested, reaches a page that answers below 400 through at most one redirect. Today the crawl recorded ${count(hops)} ${redirects} before ${code(end.final)} answered. The command follows the redirects; links rewritten to ${code(end.final)} are measured on the next check.`
          : line`Exit status 0 once ${code(from)}, the address the crawl requested, reaches a page that answers below 400 through at most one redirect. Today the crawl recorded ${count(hops)} ${redirects} and no page at the end of ${plural(hops, 'it', 'them')}.`,
        ua: fetch.ua,
        see: {
          command: command(counted.fragment),
          today: answered
            ? line`The number of redirects followed, then the status: the crawl recorded ${count(hops)} ${redirects}, then 200.`
            : end.at === 'loop'
              ? line`curl's error for too many redirects, and the number 10 with the status of a redirect: the crawl recorded redirects that loop.`
              : line`The number of redirects followed, then the status: the crawl recorded ${count(hops)} ${redirects}, and its request ended with status ${count(end.status)}.`,
          after: line`0 or 1, then a status below 400: at most one redirect before a page answers.`,
        },
      };
    }
    const fetch = fetchOf(facts, [first]);
    const on = readShown(facts, first);
    const linking = fix.affected_urls.length;
    const more = ours(
      linking === 1
        ? ''
        : ` The command reads the first of the ${linking} linking pages: run it for each.`,
    );
    return {
      command: command(holds(fetch, linksTo(addressesOf(facts, spelled(end.final)), [target]))),
      expect: line`Exit status 0 once ${on} links to ${code(end.final)} and no longer to ${code(target)} (an <a> href, however the URL is written). Today it links to ${code(target)}. ${UNREAD_HREF}${more} ${MARKER_LIMIT}`,
      ua: fetch.ua,
      see: {
        command: seeTags(facts, [first], TAGS.a, [...pathWords(target), ...pathWords(end.final)]),
        today: line`The <a> tags that link to ${code(target)}: lines that hold ${code(pathOf(target))}.`,
        after: line`The <a> tags that link to ${code(end.final)}, lines that hold ${code(pathOf(end.final))}, and none that links to ${code(target)}.`,
      },
    };
  },
});
