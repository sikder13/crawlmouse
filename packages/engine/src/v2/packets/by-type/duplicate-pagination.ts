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
 * Verify reads the first affected page, at the address it is served at. For the canonical: the one
 * `rel="canonical"` in its head is its own URL. For the content: the audit's signal is a hash of the
 * main content, which one line of shell cannot compute, so the command compares the two pages' links
 * instead (html-checks.ts `listsDiffer`): each must link somewhere the other does not, the list's
 * own pages left out. A later page that serves the first page's items again has every link the first
 * has, whatever it adds, so it does not pass; a later page that was removed does not pass either,
 * which is how the detector reads a later page that is gone. The hash is measured again on the next
 * check.
 */
import { firstPageOf } from '../../detectors/duplicate-pagination.js';
import { SIMHASH_HAMMING_K } from '../../detectors/thresholds.js';
import {
  both,
  canonicalIs,
  command,
  fetchOf,
  joined,
  listsDiffer,
  spelled,
} from '../html-checks.js';
import { servedAt } from '../served-at.js';
import { crawledWord } from '../shell.js';
import { GOOGLE_DOCS, pagesShown, plural, rowOf, subjectOf } from '../structure.js';
import { code, count, line, ours, type Line } from '../text.js';
import type { PacketEntry, PacketFacts, RecordOf } from '../types.js';

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

/** What the content half of the command compares, and what it leaves to the next check. */
const LINKS_NOT_HASH = ours(
  'The command compares links, not the content hash the audit measures, which the next check measures again.',
);
/** What the canonical half of the command does not read. */
const NOT_READ = ours('A canonical sent in an HTTP Link header is not read.');

export const duplicatePagination: PacketEntry<'duplicate_pagination'> = {
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
    const [own, firstAt] = [servedAt(facts, later), servedAt(facts, first)];
    const one = fetchOf(facts, [later]);
    const canonical = declaringFirst(fix, facts).includes(later)
      ? joined(one.fragment, canonicalIs(own, own))
      : null;
    const content = fix.conditions.includes('pagination_near_duplicate')
      ? joined(
          fetchOf(facts, [first, later]).fragment,
          listsDiffer(firstAt, own, crawledWord(listMark(later))),
        )
      : null;
    const others = ours(
      fix.affected_urls.length === 1
        ? ''
        : ' The command reads the first of the later pages; the others are measured again on the next check.',
    );
    if (canonical !== null && content !== null) {
      return {
        command: command(both(canonical, content)),
        // short, and with each URL once: a line past its bound is cut, and the limits are at its end
        expect: line`Exit status 0 once the <head> of ${code(own)} holds one <link rel="canonical">, naming its own URL (today: ${code(first)}), and that page and the first page each link to a page the other does not link to, the list's own pages left out. ${LINKS_NOT_HASH} ${NOT_READ}${others}`,
        ua: one.ua,
      };
    }
    if (canonical !== null) {
      return {
        command: command(canonical),
        expect: line`Exit status 0 once the <head> of ${code(own)} holds one <link rel="canonical">, naming its own URL in full or from the root; today it names ${code(first)}. ${NOT_READ}${others}`,
        ua: one.ua,
      };
    }
    if (content === null) {
      throw new Error('packets: a duplicate_pagination record proves nothing of its first page');
    }
    return {
      command: command(content),
      expect: line`Exit status 0 once ${code(own)} and ${code(firstAt)} each link to a page the other does not link to, the list's own pages left out: a later page that repeats the first has every link the first has. ${LINKS_NOT_HASH}${others}`,
      ua: one.ua,
    };
  },
};
