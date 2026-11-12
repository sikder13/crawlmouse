/**
 * duplicate_pagination: later pages of a paginated list that repeat its first page, judged per
 * template (detectors/duplicate-pagination.ts). The record's subject is the template key, its affected
 * pages are the later pages detected, and its conditions are the union of theirs.
 *
 * Which page carries which condition. The record does not say. A later page that declares its first
 * page as canonical is read from the check's own row for it, with the detector's `firstPageOf`. Of
 * the near-duplicate condition the packet says only what follows from the record: a detected page
 * that does not declare the first page as canonical was detected for its content.
 *
 * Verify reads the first affected page, at the address its content was read at. For the canonical: the one
 * `rel="canonical"` in its head is its own URL. For the content: the audit's signal is a hash of the
 * main content, which one line of shell cannot compute, so the command compares the two pages' links
 * instead (html-checks.ts `listsDiffer`): each must link to two pages or more of the site that the
 * other does not link to, the list's own pages left out. A later page that serves the first page's
 * items again has every link the first has, whatever it adds, so it does not pass, and one link of
 * its own on each page (a banner on the first, a link to the whole list on the later one) is not a
 * page of other items; a later page that was removed does not pass either, which is how the
 * detector reads a later page that is gone. What the rule cannot tell is in the command's `expect`:
 * a later page with fewer than two items of its own does not pass, and two pages that repeat their
 * items while each carries two links of its own to the site are read as two pages of items. The
 * hash is measured again on the next check.
 */
import { firstPageOf } from '../../detectors/duplicate-pagination.js';
import { SIMHASH_HAMMING_K } from '../../detectors/thresholds.js';
import {
  canonicalIs,
  command,
  fetchOf,
  holds,
  joined,
  listsDiffer,
  part,
  printOf,
  spelled,
} from '../html-checks.js';
import { servedAt } from '../served-at.js';
import { crawledWord } from '../shell.js';
import {
  code,
  fitting,
  GOOGLE_DOCS,
  MARKER_LIMIT,
  matchesOf,
  pagesShown,
  plural,
  readShown,
  rowOf,
  seeTags,
  slashCounts,
  subjectOf,
  TAGS,
} from '../structure.js';
import { count, line, ours, type Line } from '../text.js';
import type { PacketEntry, PacketFacts, RecordOf, See } from '../types.js';

type Fix = RecordOf<'duplicate_pagination'>;

/** The first page of the list a detected later page belongs to. */
function firstOf(later: string): string {
  const first = firstPageOf(later);
  if (first === null) {
    throw new Error('packets: a duplicate_pagination record names a page that is not a later page');
  }
  return first;
}

/** The affected pages whose row declares the first page of their list as canonical. */
function declaringFirst(fix: Fix, facts: PacketFacts): string[] {
  if (!fix.conditions.includes('pagination_canonical_to_first')) return [];
  const declaring = fix.affected_urls.filter((url) => {
    const declared = rowOf(facts, url).canonical_declared;
    const href = declared === null ? null : (declared.url ?? declared.href);
    return href !== null && spelled(href) === firstOf(url);
  });
  if (declaring.length === 0) {
    throw new Error('packets: no page of a duplicate_pagination record declares its first page');
  }
  return declaring;
}

/**
 * What marks a link as one to another page of the list `later` is in: the path segment before the
 * page number, or the query key that holds it, whichever the first page's URL lacks.
 */
export function listMark(later: string): string {
  const [page, first] = [new URL(later), new URL(firstOf(later))];
  const key = [...page.searchParams.keys()].find((k) => !first.searchParams.has(k));
  if (key !== undefined) return `${key}=`;
  const theirs = first.pathname.split('/');
  const segment = page.pathname.split('/').find((s, i) => s !== theirs[i]);
  if (segment === undefined) {
    throw new Error('packets: a later page and its first page differ by no path segment or key');
  }
  return `/${segment}/`;
}

/** What the content half of the command compares, what it cannot tell, and what it leaves to the next check. */
const LINKS_NOT_HASH = ours(
  'Links stand in for the content hash (measured on the next check): a later page with fewer than two items of its own does not pass, and repeated items go unseen when each page also holds two links of its own.',
);
/** What the canonical half of the command does not read. */
const NOT_READ = ours('An HTTP Link header is not read.');

export const duplicatePagination: PacketEntry<'duplicate_pagination'> = fitting({
  kind: 'builder',
  context: (fix, facts) => {
    const template = subjectOf(fix);
    const later = fix.affected_urls;
    const declaring = declaringFirst(fix, facts);
    const others = later.filter((u) => !declaring.includes(u));
    const lines: Line[] = [
      line`Template ${code(template)}: ${count(later.length)} later ${plural(later.length, 'page of a paginated list repeats its', 'pages of a paginated list repeat their')} first page: ${pagesShown(later)}.`,
    ];
    for (const condition of fix.conditions) {
      if (condition === 'pagination_canonical_to_first') {
        lines.push(
          line`Canonical set to the first page of the list: ${pagesShown(declaring)}.`,
          line`Google asks that each page of a sequence have its own canonical, and that the first page not be the canonical of the others: ${ours(GOOGLE_DOCS.pagination)}`,
        );
      }
      if (condition === 'pagination_near_duplicate') {
        lines.push(
          others.length === 0
            ? line`At least one of the pages above also has main content nearly identical to its first page's (64-bit content hashes within ${count(SIMHASH_HAMMING_K)} bits).`
            : line`Main content nearly identical to the first page's (64-bit content hashes within ${count(SIMHASH_HAMMING_K)} bits): ${pagesShown(others)}.`,
        );
      }
    }
    return lines;
  },
  generic: (fix, facts) => {
    const declaring = declaringFirst(fix, facts);
    const change: Line[] = [];
    for (const condition of fix.conditions) {
      if (condition === 'pagination_canonical_to_first') {
        change.push(
          line`Give each later page its own canonical: on ${pagesShown(declaring)}, set rel="canonical" to that page's own URL in place of the first page's.`,
        );
      }
      if (condition === 'pagination_near_duplicate') {
        change.push(
          line`Make each later page list its own items. A later page that serves the first page again usually means the page number in the URL does not reach the query that builds the list.`,
        );
      }
    }
    return {
      change,
      keep: [
        line`Keep each later page at its own URL, and keep the <a href> links from one page of the list to the next: Google reads the pages of a sequence as separate pages.`,
      ],
    };
  },
  stacks: {},
  verify: (fix, facts) => {
    const [later] = fix.affected_urls;
    if (later === undefined) {
      throw new Error('packets: a duplicate_pagination record names no later page');
    }
    const first = firstOf(later);
    // the canonical a page should name is its own address; the request goes where its content was read
    const own = servedAt(facts, later);
    const [shown, firstShown] = [readShown(facts, later), readShown(facts, first)];
    const one = fetchOf(facts, [later]);
    const two = fetchOf(facts, [first, later]);
    const canonical = declaringFirst(fix, facts).includes(later);
    const content = fix.conditions.includes('pagination_near_duplicate');
    const differ = listsDiffer(crawledWord(listMark(later)));
    const others = ours(
      fix.affected_urls.length === 1 ? '' : ' Only the first of the later pages is read.',
    );
    const seeCanonical: See = {
      command: seeTags(facts, [later], TAGS.canonical),
      today: line`The page's canonical tag, which names the first page of the list: ${code(first)}.`,
      after: line`The page's canonical tag, naming its own URL: ${code(own)}.`,
    };
    // each page's tags once, whatever number of times the page holds one (an item linked from its
    // picture and from its title), then the tags that only one of the two pages holds
    const tagsOnce = joined(matchesOf(TAGS.a), part` | sort -u`);
    const seeContent: See = {
      command: command(
        printOf(facts, [first]).fragment,
        tagsOnce,
        part` | { cat; `,
        printOf(facts, [later]).fragment,
        tagsOnce,
        part`; } | sort | uniq -u`,
      ),
      today: line`The <a> tags that are on one of the two pages and not on the other. The record does not hold the pages' links: it holds that their main content is nearly identical, so expect few lines or none besides the links between the list's own pages.`,
      after: line`The <a> tags of the items each page lists and the other does not.`,
    };
    const how = slashCounts(facts, later) ? 'slashed' : 'alike';
    const slash = ours(how === 'slashed' ? ', final slash included' : '');
    if (canonical && content) {
      return {
        // one request for the two pages: the later page, the second, is read for both
        command: command(holds(two, canonicalIs(own, 2, how), differ)),
        expect: line`Exit status 0 once the <head> of ${shown} holds one <link rel="canonical"> naming its own URL${slash}, not the first page's as today, and it and the first page each link to two or more site pages the other lacks, list pages aside. ${LINKS_NOT_HASH} ${NOT_READ}${others} ${MARKER_LIMIT}`,
        ua: one.ua,
        see: seeCanonical,
      };
    }
    if (canonical) {
      return {
        command: command(holds(one, canonicalIs(own, 1, how))),
        expect: line`Exit status 0 once the <head> of ${shown} holds one <link rel="canonical"> naming its own URL${slash}, however the URL is written; today it names ${code(first)}. ${NOT_READ}${others} ${MARKER_LIMIT}`,
        ua: one.ua,
        see: seeCanonical,
      };
    }
    if (!content) {
      throw new Error('packets: a duplicate_pagination record proves nothing of its first page');
    }
    return {
      command: command(holds(two, differ)),
      expect: line`Exit status 0 once ${shown} and ${firstShown} each link to two or more site pages the other lacks, list pages aside: a later page that repeats the first has every link the first has. ${LINKS_NOT_HASH}${others} ${MARKER_LIMIT}`,
      ua: one.ua,
      see: seeContent,
    };
  },
});
