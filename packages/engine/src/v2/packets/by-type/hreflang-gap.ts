/**
 * hreflang_gap: a cluster of alternate-language pages whose annotations are incomplete
 * (detectors/hreflang-gaps.ts). The record's subject is the cluster's lowest URL, its affected pages
 * are the members that carry a defect, and its conditions are the cases that occur in the cluster.
 *
 * The record does not say which page carries which condition (grade/spec.ts `CARRIES`), so the packet
 * says "at least one of them" of each condition unless the record marks one page, when the
 * conditions are that page's.
 *
 * Verify reads the first marked page's own annotations. Every page of a sound cluster lists itself
 * under a language code and holds an x-default, so the command asks that of the page; what else it
 * asks (`needsOf`) is read from the check's rows for the page and for the members the record names:
 * the pages it must name back, and the values and targets it must stop carrying.
 */
import { isValidHreflang } from '../../detectors/hreflang-gaps.js';
import { isRedirect, isUnread } from '../../detectors/scope.js';
import type { Condition } from '../../detectors/types.js';
import {
  command,
  fetchOf,
  hreflangHolds,
  HREFLANG_PAIRS,
  hrefForms,
  spelled,
} from '../html-checks.js';
import { crawledWord } from '../shell.js';
import { DOCS_READ, GOOGLE_DOCS, pagesShown, plural, subjectOf } from '../structure.js';
import { code, count, line, list, ours, type Line, type Safe } from '../text.js';
import type { Change, PacketEntry, PacketFacts, RecordOf } from '../types.js';

type Fix = RecordOf<'hreflang_gap'>;

/** The values and pages a line or a command names before it counts the rest. */
const MAX_NAMED = 12;
/** The longest hreflang value the worker keeps is 64 characters. */
const MAX_VALUE_CHARS = 64;

interface Annotation {
  lang: string;
  /** The alternate's URL, in the engine's spelling. */
  href: string;
}

/**
 * A member's annotations as the detector reads them: of a page answering 200 at its own URL, whose
 * list was read whole. Null for any other page.
 */
function annotationsOf(facts: PacketFacts, url: string): Annotation[] | null {
  const row = facts.pages.get(url);
  if (row === undefined || row.status_code !== 200 || row.hreflang === null) return null;
  if (!row.hreflang.complete || row.final_url === null || spelled(row.final_url) !== url)
    return null;
  return row.hreflang.links.map((l) => ({ lang: l.hreflang, href: spelled(l.href) }));
}

/** Why a crawled alternate cannot annotate back, as the detector decides it; null when it can or is unknown. */
function deadEnd(facts: PacketFacts, url: string): Condition | null {
  const row = facts.pages.get(url);
  if (row === undefined || isUnread(row.status_code)) return null;
  if (row.status_code !== 200) {
    return isRedirect(row.status_code) ? 'hreflang_alternate_redirects' : 'hreflang_alternate_gone';
  }
  const landed = row.final_url === null ? null : spelled(row.final_url);
  return landed !== null && landed !== url ? 'hreflang_alternate_redirects' : null;
}

interface Needs {
  page: string;
  /** Members that name the page and that it does not name back. */
  back: string[];
  /** Values it carries that are not valid codes. */
  invalid: string[];
  /** Alternates it names that redirect or are gone. */
  dead: string[];
}

function needsOf(fix: Fix, facts: PacketFacts): Needs {
  const [page] = fix.affected_urls;
  const own = page === undefined ? null : annotationsOf(facts, page);
  if (page === undefined || own === null) {
    throw new Error('packets: an hreflang_gap record marks a page whose annotations were not read');
  }
  const proved = (c: Condition) => fix.conditions.includes(c);
  const named = new Set(own.map((l) => l.href));
  return {
    page,
    back: proved('hreflang_missing_return')
      ? fix.evidence.pages.filter(
          (member) =>
            member !== page &&
            !named.has(member) &&
            (annotationsOf(facts, member) ?? []).some((l) => l.href === page),
        )
      : [],
    invalid: proved('hreflang_invalid_code')
      ? [...new Set(own.filter((l) => !isValidHreflang(l.lang)).map((l) => l.lang))]
      : [],
    dead: [...named].filter((target) => {
      if (target === page || annotationsOf(facts, target) !== null) return false;
      const why = deadEnd(facts, target);
      return why !== null && proved(why);
    }),
  };
}

/** The values that are not valid codes on the pages the record marks. */
function invalidValues(fix: Fix, facts: PacketFacts): string[] {
  const values = fix.affected_urls.flatMap((url) =>
    (annotationsOf(facts, url) ?? []).filter((l) => !isValidHreflang(l.lang)).map((l) => l.lang),
  );
  return [...new Set(values)];
}

const values = (langs: readonly string[]): Safe =>
  list(
    langs.map((l) => code(l, MAX_VALUE_CHARS)),
    MAX_NAMED,
    'value',
  );

/** One sentence for a condition the record proves; `who` is the page it marks, or "at least one". */
function sentence(condition: Condition, who: Safe, fix: Fix, facts: PacketFacts): Line[] {
  switch (condition) {
    case 'hreflang_missing_self':
      return [line`${who} does not list itself among its own annotations under a language code.`];
    case 'hreflang_missing_return':
      return [
        line`${who} is named as an alternate by another page of the cluster and does not name that page back. Google ignores annotations that do not point both ways.`,
      ];
    case 'hreflang_alternate_redirects':
      return [line`${who} names an alternate that redirects.`];
    case 'hreflang_alternate_gone':
      return [line`${who} names an alternate that answers 404 or 410.`];
    case 'hreflang_missing_x_default':
      return [
        line`${who} has no x-default annotation. Google recommends one and does not require it.`,
      ];
    case 'hreflang_invalid_code': {
      const invalid = invalidValues(fix, facts);
      return [
        invalid.length === 0
          ? line`${who} uses an hreflang value that is not a valid code.`
          : line`${who} uses an hreflang value that is not a valid code: ${values(invalid)}.`,
      ];
    }
    default:
      return [];
  }
}

const STEPS: Readonly<Partial<Record<Condition, Line>>> = {
  hreflang_missing_self: line`Add each page's own URL to its set under its own language code; an x-default that names the page does not count as that.`,
  hreflang_missing_return: line`Where one page names another, make the other name it back.`,
  hreflang_alternate_redirects: line`Point each annotation at the URL that answers 200 itself, not at one that redirects there.`,
  hreflang_alternate_gone: line`Remove each annotation that names a page answering 404 or 410, or restore the page.`,
  hreflang_missing_x_default: line`Add an x-default annotation to each page, naming the page for visitors whose language none of the others matches.`,
  hreflang_invalid_code: line`Write each hreflang value as an ISO 639-1 language code, optionally followed by an ISO 15924 script and an ISO 3166-1 alpha-2 region: en, en-GB, zh-Hant-TW. A region alone is not valid.`,
};

const generic = (fix: Fix): Change => ({
  change: [
    line`Give every page of the cluster the same full set of annotations: one <link rel="alternate" hreflang="…" href="…"> in the <head> for each language version, the page itself included, each with an absolute URL.`,
    ...fix.conditions.flatMap((c) => STEPS[c] ?? []),
  ],
  keep: [
    line`Keep each page at its URL, and keep the annotations of the pages that carry no defect in step with the ones you change: every page lists the same set.`,
  ],
});

const NEXT_METADATA = 'https://nextjs.org/docs/app/api-reference/functions/generate-metadata';

export const hreflangGap: PacketEntry<'hreflang_gap'> = {
  kind: 'builder',
  context: (fix, facts) => {
    const marked = fix.affected_urls.length;
    const members = fix.evidence.pages.length;
    const who = ours(marked === 1 ? 'It' : 'At least one of them');
    return [
      line`The hreflang annotations join ${code(subjectOf(fix))} and ${count(members - 1)} other crawled ${plural(members - 1, 'page', 'pages')} into one cluster. ${count(marked)} of the ${count(members)} ${plural(marked, 'carries', 'carry')} a defect: ${pagesShown(fix.affected_urls)}.`,
      ...fix.conditions.flatMap((c) => sentence(c, who, fix, facts)),
      line`Google's rules for hreflang: ${ours(GOOGLE_DOCS.hreflang)}`,
    ];
  },
  generic: (fix) => generic(fix),
  stacks: {
    nextjs: {
      write: (fix) => {
        const { change, keep } = generic(fix);
        return {
          change: [
            line`In the App Router the annotations come from alternates.languages (an hreflang value to a URL) in the metadata export, or in generateMetadata, of the page.js of the route or of a layout.js above it. Make the changes below there.`,
            ...change,
          ],
          keep,
        };
      },
      sources: [
        {
          title: 'generateMetadata',
          url: NEXT_METADATA,
          read: DOCS_READ,
          supports:
            'alternates.languages in the metadata export or generateMetadata of layout.js and page.js renders link rel="alternate" hreflang elements',
        },
      ],
    },
  },
  verify: (fix, facts) => {
    const needs = needsOf(fix, facts);
    const fetch = fetchOf(facts, [needs.page]);
    const back = needs.back.slice(0, MAX_NAMED);
    const stale = [
      ...needs.invalid.map((v) => ({
        shown: code(v, MAX_VALUE_CHARS),
        word: crawledWord(v, MAX_VALUE_CHARS),
      })),
      ...needs.dead.map((u) => ({ shown: code(u), word: hrefForms(u)[0]! })),
    ];
    const others = ours(
      fix.affected_urls.length === 1
        ? ''
        : ' The command reads the first of the pages marked; the others are measured again on the next check.',
    );
    return {
      command: command(
        fetch.fragment,
        HREFLANG_PAIRS,
        hreflangHolds(
          hrefForms(needs.page)[0]!,
          back.map((u) => hrefForms(u)[0]!),
          stale.slice(0, MAX_NAMED).map((s) => s.word),
        ),
      ),
      expect: line`Exit status 0 once ${code(needs.page)} lists itself under a language code, holds an x-default${ours(needs.back.length === 0 ? '' : ', names ')}${pagesShown(needs.back, MAX_NAMED)}${ours(stale.length === 0 ? '' : ', and no longer holds ')}${list(
        stale.map((s) => s.shown),
        MAX_NAMED,
        'annotation',
      )}. Annotations are read from <link> elements with quoted, absolute URLs.${others}`,
      ua: fetch.ua,
    };
  },
};
