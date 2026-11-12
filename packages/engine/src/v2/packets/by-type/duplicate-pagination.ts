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
 * Verify reads the first affected page. For the canonical: its `rel="canonical"` is its own URL. For
 * the content: it links to a page the first page does not link to, leaving out the list's own pages.
 * A list page shows its items as links, so a later page that repeats the first has none of its own;
 * the content hash itself is measured again on the next check.
 */
import { firstPageOf } from '../../detectors/duplicate-pagination.js';
import { SIMHASH_HAMMING_K } from '../../detectors/thresholds.js';
import {
  ANCHOR_HREFS,
  anyOf,
  both,
  CANONICAL_HREF,
  command,
  fetchOf,
  hrefForms,
  joined,
  linksBeyondFirst,
  spelled,
} from '../html-checks.js';
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
          line`${plural(declaring.length, 'Declares the first page of its list as its canonical', 'Declare the first page of their list as their canonical')}: ${pagesShown(declaring)}.`,
          line`Google asks that each page of a sequence have its own canonical, and that the first page not be the canonical of the others: ${ours(GOOGLE_DOCS.pagination)}`,
        );
      }
      if (condition === 'pagination_near_duplicate') {
        lines.push(
          others.length === 0
            ? line`At least one of the pages above also serves nearly the same main content as its first page (a 64-bit content hash within ${count(SIMHASH_HAMMING_K)} bits of it).`
            : line`${plural(others.length, 'Serves', 'Serve')} nearly the same main content as the first page (a 64-bit content hash within ${count(SIMHASH_HAMMING_K)} bits of it): ${pagesShown(others)}.`,
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
          line`If a list has no items for a later page, stop linking to that page and let it answer 404.`,
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
    const one = fetchOf(facts, [later]);
    const canonical = declaringFirst(fix, facts).includes(later)
      ? joined(one.fragment, CANONICAL_HREF, anyOf(hrefForms(later)))
      : null;
    const content = fix.conditions.includes('pagination_near_duplicate')
      ? joined(
          fetchOf(facts, [first, later]).fragment,
          ANCHOR_HREFS,
          linksBeyondFirst(crawledWord(listMark(later)), hrefForms(first)),
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
        expect: line`Exit status 0 once the rel="canonical" of ${code(later)} is its own URL (today it is ${code(first)}), and the page links to a page that ${code(first)} does not link to and that is not another page of the list: items of its own. The content hash is measured again on the next check.${others}`,
        ua: one.ua,
      };
    }
    if (canonical !== null) {
      return {
        command: command(canonical),
        expect: line`Exit status 0 once the rel="canonical" of ${code(later)} is its own URL, in full or from the root, in quotes; today it is ${code(first)}.${others}`,
        ua: one.ua,
      };
    }
    if (content === null) {
      throw new Error('packets: a duplicate_pagination record proves nothing of its first page');
    }
    return {
      command: command(content),
      expect: line`Exit status 0 once ${code(later)} links to a page that ${code(first)} does not link to and that is not another page of the list: items of its own. The content hash is measured again on the next check.${others}`,
      ua: one.ua,
    };
  },
};
