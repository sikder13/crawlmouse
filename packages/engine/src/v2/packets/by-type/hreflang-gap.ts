/**
 * hreflang_gap: a cluster of alternate-language pages whose annotations are incomplete
 * (detectors/hreflang-gaps.ts). The record's subject is the cluster's lowest URL, its affected pages
 * are the members that carry a defect, and its conditions are the cases that occur in the cluster.
 *
 * The record does not say which page carries which condition (grade/spec.ts `CARRIES`), so the packet
 * says "at least one of them" of each condition unless the record marks one page, when the
 * conditions are that page's.
 *
 * Verify reads the first marked page's own annotations, in the `<head>` of the HTML it is served
 * with. Every page of a sound cluster lists itself under a language code, so the command asks that
 * of the page; what else it asks (`needsOf`) is read from the check's rows for the page and for the
 * members the record names: the pages it must name back, and the values and targets it must stop
 * carrying. Google recommends an x-default and does not require one, and the audit keeps the fix open
 * until the marked pages have one (detectors/hreflang-gaps.ts `judge`), so the command asks for it
 * whenever the record proves one missing; the step for it says why. The command requests no alternate, reads
 * no HTTP `Link` header and no sitemap, and checks a value's form, not the registry of codes: its
 * `expect` says so.
 */
import { isValidHreflang } from '../../detectors/hreflang-gaps.js';
import { isRedirect, isUnread } from '../../detectors/scope.js';
import type { Condition } from '../../detectors/types.js';
import { command, fetchOf, holds, hreflangHolds, listed, spelled } from '../html-checks.js';
import { servedAt } from '../served-at.js';
import { crawledWord, url } from '../shell.js';
import {
  code,
  DOCS_READ,
  fitting,
  GOOGLE_DOCS,
  list,
  MARKER_LIMIT,
  NEXT_LIMITED_BOTS_SOURCE,
  NEXT_METADATA,
  NEXT_STREAMING,
  pagesShown,
  phrase,
  plural,
  seeTags,
  subjectOf,
  TAGS,
} from '../structure.js';
import { count, line, ours, type Line, type Safe } from '../text.js';
import type { Change, PacketEntry, PacketFacts, RecordOf } from '../types.js';

type Fix = RecordOf<'hreflang_gap'>;

/** The values and pages a line or a command names before it counts the rest. */
const MAX_NAMED = 12;
/** The annotations the readable layer's lines name before they count the rest. */
const MAX_SEEN = 6;
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
  hreflang_missing_x_default: line`Add an x-default annotation to each page, naming the page for visitors whose language none of the others matches. Google recommends it and does not require it; the audit's fix stays open until each page has one.`,
  hreflang_invalid_code: line`Write each hreflang value as an ISO 639-1 language code, optionally followed by an ISO 15924 script and an ISO 3166-1 alpha-2 region: en, en-GB, zh-Hant-TW. A region alone is not valid.`,
};

const SAME_SET = line`Give every page of the cluster the same full set of annotations: one <link rel="alternate" hreflang="…" href="…"> in the <head> for each language version, the page itself included, each with an absolute URL.`;

const X_DEFAULT: Condition = 'hreflang_missing_x_default';

const generic = (fix: Fix): Change => ({
  change: [SAME_SET, ...fix.conditions.flatMap((c) => STEPS[c] ?? [])],
  keep: [
    line`Keep each page at its URL, and keep the annotations of the pages that carry no defect in step with the ones you change: every page lists the same set.`,
  ],
});

/**
 * The Next.js body. The page cited shows language codes as the keys of alternates.languages and no
 * x-default, so the step for one is left to the generic body; a record that proves only its absence
 * has no Next.js body.
 */
function nextjs(fix: Fix): Change | null {
  const steps = fix.conditions.filter((c) => c !== X_DEFAULT).flatMap((c) => STEPS[c] ?? []);
  if (steps.length === 0) return null;
  return {
    change: [
      line`These steps are for the App Router (the app directory). There the annotations come from alternates.languages (a map from hreflang value to URL) in the metadata export, or in generateMetadata, of the page.js of the route or of a layout.js above it.`,
      SAME_SET,
      ...steps,
      line`Metadata objects are merged shallowly: a segment that sets alternates replaces the whole alternates object of the layouts above it. Where a page sets alternates.languages, carry the layout's alternates.canonical, media and types into the same object (share them from one module, or read the parent's resolved metadata from the second argument of generateMetadata), or the page loses its canonical.`,
      NEXT_STREAMING,
      ...(fix.conditions.includes(X_DEFAULT)
        ? [
            line`The Next.js page cited shows no x-default among the keys of alternates.languages: for that annotation, follow the generic rewrite and confirm the tag in the HTML served.`,
          ]
        : []),
    ],
    keep: [
      ...generic(fix).keep,
      line`Keep the other fields of alternates each page has today (canonical, media, types).`,
    ],
  };
}

export const hreflangGap: PacketEntry<'hreflang_gap'> = fitting({
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
      write: (fix) => nextjs(fix),
      sources: [
        {
          title: 'generateMetadata',
          url: NEXT_METADATA,
          read: DOCS_READ,
          supports:
            'metadata and generateMetadata are exported from layout.js and page.js, in Server Components; alternates.languages and its <link rel="alternate" hreflang> output; Merging: objects are shallowly merged and nested fields are overwritten by the last segment to define them, shared through a separate variable or the parent argument; "If the page can be prerendered and generateMetadata doesn\'t introduce dynamic behavior, the resulting metadata is included in the page\'s initial HTML. Otherwise the metadata resolved from generateMetadata can be streamed"; Streaming metadata: tags appended to the <body>, and in the <head> for HTML-limited bots',
        },
        NEXT_LIMITED_BOTS_SOURCE,
      ],
    },
  },
  verify: (fix, facts) => {
    const needs = needsOf(fix, facts);
    const own = servedAt(facts, needs.page);
    const fetch = fetchOf(facts, [needs.page]);
    // the audit keeps the fix open while a marked page has no x-default (detectors/hreflang-gaps.ts
    // `judge`), so the command asks for one whenever the record proves one missing
    const fallback = fix.conditions.includes(X_DEFAULT);
    const back = listed(needs.back, MAX_NAMED, url);
    const goneValues = listed(needs.invalid, MAX_NAMED, (v) => crawledWord(v, MAX_VALUE_CHARS));
    const goneUrls = listed(needs.dead, MAX_NAMED - goneValues.length, url);
    const stale = [
      ...needs.invalid.map((v) => code(v, MAX_VALUE_CHARS)),
      ...needs.dead.map((u) => code(u)),
    ];
    const left =
      needs.back.length - back.length + stale.length - goneValues.length - goneUrls.length;
    const others = ours(
      fix.affected_urls.length === 1 ? '' : ' Only the first marked page is read.',
    );
    const today = annotationsOf(facts, needs.page) ?? [];
    const asked = needs.back.length + stale.length;
    return {
      command: command(
        holds(
          fetch,
          hreflangHolds({
            self: own,
            fallback,
            must: back,
            goneValues: goneValues.map((v) => crawledWord(v, MAX_VALUE_CHARS)),
            goneUrls,
          }),
        ),
      ),
      // what the command leaves out and does not read comes before the lists: a list is what a
      // long line is shortened in (structure.ts `fitting`)
      expect: line`Exit status 0 once ${code(own)} lists itself under a value with the form of a language code${ours(fallback ? ' and holds an x-default' : '')}, and carries no value of another form. Only <link> elements in the <head> are read, no Link header or sitemap; no alternate is requested; a value's form is checked, not the registry of codes.${others} ${MARKER_LIMIT}${ours(left === 0 ? '' : ` Of the ${asked} URLs and values that follow, the command leaves ${left} out: too long.`)}${ours(needs.back.length === 0 ? '' : ' It must name ')}${pagesShown(needs.back, MAX_NAMED)}${ours(needs.back.length === 0 ? '' : '.')}${ours(stale.length === 0 ? '' : ' It must drop ')}${list(
        stale,
        MAX_NAMED,
        'annotation',
      )}${ours(stale.length === 0 ? '' : '.')}`,
      ua: fetch.ua,
      see: {
        command: seeTags(facts, [needs.page], TAGS.hreflang),
        today:
          today.length === 0
            ? line`Nothing: the crawl read no hreflang annotation on this page.`
            : line`The page's ${count(today.length)} hreflang ${plural(today.length, 'tag', 'tags')}, as the crawl read ${plural(today.length, 'it', 'them')}: ${list(
                today.map((l) => phrase`${code(l.lang, MAX_VALUE_CHARS)} for ${code(l.href)}`),
                MAX_SEEN,
                'tag',
              )}.`,
        after: line`A tag that names ${code(own)} under its own language code${ours(fallback ? ', an x-default tag' : '')}${ours(needs.back.length === 0 ? '' : needs.back.length === 1 ? ', a tag for ' : ', a tag for each of ')}${pagesShown(needs.back, MAX_SEEN)}${ours(stale.length === 0 ? '' : ', and no tag that holds ')}${list(stale, MAX_SEEN, 'annotation')}.`,
      },
    };
  },
});
