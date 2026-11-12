/**
 * canonical_mismatch: a page whose rel=canonical cannot be honoured, or that the site links to under
 * a URL that is not its canonical (detectors/canonical-mismatch.ts). A record proves at most one
 * fault of the canonical's target, and, apart from it, that pages link to the non-canonical URL.
 *
 * What the canonical should be (`read`) comes from the check's rows:
 *   - the target is on another host, gone, or disallowed for search: the page's own URL;
 *   - the target redirects: where it landed, when that page answered 200 and declares itself or no
 *     canonical; otherwise the page's own URL;
 *   - the target declares another canonical: that URL, when the check holds it answering 200 at
 *     itself and declaring itself or none; otherwise the page's own URL;
 *   - no fault of the target (links only): the canonical stands, and the links move to it, when the
 *     check holds the target answering 200 at itself and declaring itself or none (`answersAt`). A
 *     target the crawl did not read, that answered otherwise, or that is not an http or https URL is
 *     not taken to stand: the packet then asks for the page's own URL, or for the target to be
 *     checked by hand.
 * Links to the page move too whenever the expected canonical is another URL than the page.
 *
 * The page is named at the address it is served at, and requested at the address its content was
 * read at (served-at.ts). Verify reads the `<link rel="canonical">` in the page's head for the expected
 * URL, and, when links move, a linking page for a link to the canonical and none to the page
 * (html-checks.ts).
 */
import type { PageResult } from '@crawlmouse/types/v2';
import { SEARCH_ENGINES } from '../../detectors/scope.js';
import type { Condition } from '../../detectors/types.js';
import {
  canonicalIs,
  command,
  fetchOf,
  holds,
  httpUrl,
  linksTo,
  sameInCommand,
  spelled,
} from '../html-checks.js';
import { servedAt } from '../served-at.js';
import {
  addressesOf,
  DOCS_READ,
  GOOGLE_DOCS,
  NEXT_LIMITED_BOTS_SOURCE,
  NEXT_METADATA,
  NEXT_STREAMING,
  pagesShown,
  pathOf,
  pathWord,
  plural,
  readShown,
  rowOf,
  seeTags,
  subjectOf,
  TAGS,
  UNREAD_HREF,
} from '../structure.js';
import { code, count, line, list, ours, type Line } from '../text.js';
import type { Change, PacketEntry, PacketFacts, RecordOf, See } from '../types.js';

type Fix = RecordOf<'canonical_mismatch'>;

const LINKED: Condition = 'linked_under_non_canonical';

/** The URL a row declares as its canonical, as resolved; null when it declares none or was not read. */
const declaredBy = (row: PageResult | null): string | null =>
  row?.canonical_declared == null
    ? null
    : (row.canonical_declared.url ?? row.canonical_declared.href);

/** The row was read declaring `url` itself, or no canonical at all. */
function declaresItself(row: PageResult, url: string): boolean {
  if (row.canonical_declared === null) return false;
  const declared = declaredBy(row);
  return declared === null || spelled(declared) === url;
}

/** The row answered 200 at `url` and declares it, or nothing, as its canonical. */
const answersAt = (row: PageResult, url: string): boolean =>
  row.status_code === 200 &&
  row.final_url !== null &&
  spelled(row.final_url) === url &&
  declaresItself(row, url);

interface Reading {
  /** The page, in the record's spelling. */
  page: string;
  /** The address the page is served at: what the packet prints as the page's own URL. */
  own: string;
  /** The canonical the page declares, as resolved, or as written when it did not resolve. */
  declared: string;
  /** `declared` in the engine's spelling; null when it is not an http or https URL. */
  target: string | null;
  /** The crawled row that answered at the canonical's target; null when the check holds none. */
  row: PageResult | null;
  /** The fault of the canonical's target the record proves; null when it proves none. */
  fault: Condition | null;
  /** The pages that link to the page, when the record proves that. */
  linking: string[];
  /** What the page's canonical should be, in the record's spelling. */
  expected: string;
  /** Whether the canonical the page declares today is the expected one. */
  stands: boolean;
  /** Where the links to the page should go; null when they stay. */
  linksTo: string | null;
}

/** What the canonical should be when the record proves `fault` of its target. */
function expectedOf(page: string, at: PageResult | null, fault: Condition, facts: PacketFacts) {
  if (fault === 'canonical_target_redirects' && at !== null && at.status_code === 200) {
    const landed = at.final_url === null ? null : httpUrl(at.final_url);
    if (landed !== null && declaresItself(at, landed)) return landed;
  }
  if (fault === 'canonical_target_not_canonical') {
    const next = declaredBy(at);
    const row = next === null ? undefined : facts.pages.get(spelled(next));
    if (row !== undefined && answersAt(row, row.url)) return row.url;
  }
  return page;
}

function read(fix: Fix, facts: PacketFacts): Reading {
  const page = subjectOf(fix);
  const declared = declaredBy(rowOf(facts, page));
  if (declared === null) {
    throw new Error('packets: a canonical_mismatch record names a page that declares no canonical');
  }
  const target = httpUrl(declared);
  const other = fix.evidence.pages.find((p) => p !== page);
  const at = other === undefined ? null : (facts.pages.get(other) ?? null);
  const fault = fix.conditions.find((c) => c !== LINKED) ?? null;
  const stands = fault === null && target !== null && at !== null && answersAt(at, target);
  const expected = fault === null ? (stands ? target : page) : expectedOf(page, at, fault, facts);
  const linking = fix.conditions.includes(LINKED)
    ? [...new Set(fix.evidence.edges.map((e) => e.from_url))]
    : [];
  return {
    page,
    own: servedAt(facts, page),
    declared,
    target,
    row: at,
    fault,
    linking,
    expected,
    stands,
    linksTo: linking.length > 0 && expected !== page ? expected : null,
  };
}

/** Why a canonical no fault was proven of is still not taken to stand, from the rows the record names. */
function unconfirmed(r: Reading): Line[] {
  if (r.fault !== null || r.stands) return [];
  const target = code(r.declared);
  if (r.target === null) return [line`${target} is not an http or https URL, so it names no page.`];
  if (r.row === null) {
    return [
      line`The crawl holds no page that answered at ${target}, so the audit cannot say the canonical names a live page.`,
    ];
  }
  return [
    r.row.status_code === 200
      ? line`The crawl could not confirm that ${target} answers at that URL and declares itself, or nothing, as its canonical.`
      : line`The crawl's request for ${target} ended with status ${count(r.row.status_code)}, so the audit cannot say the canonical names a live page.`,
  ];
}

/** One sentence for a condition the record proves, from the rows it names. */
function sentence(condition: Condition, r: Reading): Line[] {
  const target = code(r.declared);
  switch (condition) {
    case 'canonical_cross_host':
      return [
        r.target === null
          ? line`${target} is not a web address (http or https), so it names no page a search engine can index in place of this one.`
          : line`${target} is on another host than the page: the canonical asks search engines to index that URL in place of this one.`,
      ];
    case 'canonical_target_redirects':
      if (r.row === null || r.row.final_url === null) return [line`${target} redirects.`];
      return [
        r.row.status_code === 200
          ? line`${target} redirects to ${code(r.row.final_url)}.`
          : line`${target} is a redirect: the crawl's request for it ended with status ${count(r.row.status_code)}.`,
      ];
    case 'canonical_target_gone':
      return [
        r.row === null
          ? line`${target} is gone.`
          : line`${target} answers ${count(r.row.status_code)}: the page the canonical names is gone.`,
      ];
    case 'canonical_target_not_canonical': {
      const next = declaredBy(r.row);
      return [
        next === null
          ? line`${target} itself declares another canonical.`
          : line`${target} itself declares another canonical, ${code(next)}.`,
      ];
    }
    case 'canonical_target_disallowed':
      return [
        line`robots.txt disallows ${target} for ${list(
          SEARCH_ENGINES.map((token) => ours(token)),
          SEARCH_ENGINES.length,
          'crawler',
        )}, so a search engine cannot read the page the canonical names.`,
      ];
    case 'linked_under_non_canonical':
      return [
        line`${count(r.linking.length)} ${plural(r.linking.length, 'page links', 'pages link')} to ${code(r.own)}, a URL that names another as its canonical: ${pagesShown(r.linking)}.`,
      ];
    default:
      return [];
  }
}

/** The step that moves the links, when they move. */
function linkSteps(r: Reading, facts: PacketFacts): Line[] {
  if (r.linksTo === null) return [];
  return [
    line`Change the links to ${code(r.own)} on ${pagesShown(r.linking)} so that they point at ${code(servedAt(facts, r.linksTo))}. Google: "When linking within your site, link to the canonical URL rather than a duplicate URL" (${ours(GOOGLE_DOCS.canonical)}).`,
    line`Where a link is meant to open this URL as a variant (a filter, a sort order, a tracked link), leaving it is a choice the canonical already covers; the command below stays non-zero while such a link is on the page it reads.`,
    ...(r.fault === null
      ? [
          line`If ${code(r.own)} is meant to be indexed in its own right, make its canonical its own URL instead; the command below checks the links.`,
        ]
      : []),
  ];
}

function keepOf(r: Reading): Line[] {
  return [
    line`Keep ${code(r.own)} answering 200 with its content: no redirect is asked for.`,
    ...(r.linking.length > 0 && r.linksTo === null
      ? [
          line`Keep the links to ${code(r.own)}: once it is its own canonical they point at the canonical URL.`,
        ]
      : []),
  ];
}

const OTHER_URL = line`If another live URL of this site is the one meant to be indexed for this content, name that one instead; the command below checks for the page's own URL.`;

/** The step that sets the canonical, with why that URL; none when the canonical stands. */
function canonicalStep(r: Reading, facts: PacketFacts): Line[] {
  if (r.stands) return [];
  if (r.fault === null) {
    return [
      line`Set the rel="canonical" of ${code(r.own)} to its own URL, or check ${code(r.declared)} by hand: if it is a live page that is meant to be indexed for this content, the canonical can stay, and the links to ${code(r.own)} belong on that URL. The command below checks for the page's own URL.`,
    ];
  }
  if (r.fault === 'canonical_cross_host' && r.target !== null) {
    return [
      line`Decide first whether ${code(r.declared)} is deliberate: a page republished from another site can name the original as its canonical on purpose. If it is, leave it; this fix does not apply.`,
      line`Otherwise set the rel="canonical" of ${code(r.own)} to its own URL.`,
      OTHER_URL,
    ];
  }
  if (r.expected === r.page) {
    return [line`Set the rel="canonical" of ${code(r.own)} to its own URL.`, OTHER_URL];
  }
  const expected = code(servedAt(facts, r.expected));
  return [
    r.fault === 'canonical_target_redirects'
      ? line`Set the rel="canonical" of ${code(r.own)} to ${expected}, where ${code(r.declared)} lands.`
      : line`Set the rel="canonical" of ${code(r.own)} to ${expected}, the canonical that ${code(r.declared)} itself declares.`,
  ];
}

const HOW = line`Write it as one <link rel="canonical"> in the <head>, with an absolute URL. Google accepts the element only in the <head>, and asks for absolute paths (${ours(GOOGLE_DOCS.canonical)}).`;

const generic = (r: Reading, facts: PacketFacts): Change => ({
  change: [...canonicalStep(r, facts), ...(r.stands ? [] : [HOW]), ...linkSteps(r, facts)],
  keep: keepOf(r),
});

/** The Next.js body: where the tag comes from in the App Router. None when the canonical stands. */
function nextjs(r: Reading, facts: PacketFacts): Change | null {
  if (r.stands) return null;
  return {
    change: [
      line`These steps are for the App Router (the app directory). There the tag comes from alternates.canonical in the metadata export, or in generateMetadata, of the page.js of the route or of a layout.js above it.`,
      ...canonicalStep(r, facts),
      line`Metadata objects are merged shallowly: a segment that sets alternates replaces the whole alternates object of the layouts above it. If a layout sets alternates.languages, media or types, carry them into the object you write (share them from one module, or read the parent's resolved metadata from the second argument of generateMetadata), or the page loses those tags.`,
      line`Give an absolute URL, or a path with metadataBase set in the root layout: Next.js composes the two.`,
      NEXT_STREAMING,
      ...linkSteps(r, facts),
    ],
    keep: [
      ...keepOf(r),
      line`Keep the other fields of alternates the page has today (languages, media, types).`,
    ],
  };
}

/** What the canonical half of the command does not read. */
const NOT_READ = ours('A canonical sent in an HTTP Link header is not read.');

export const canonicalMismatch: PacketEntry<'canonical_mismatch'> = {
  kind: 'builder',
  context: (fix, facts) => {
    const r = read(fix, facts);
    return [
      line`${code(r.own)} declares ${code(r.declared)} as its canonical.`,
      ...fix.conditions.flatMap((c) => sentence(c, r)),
      ...unconfirmed(r),
    ];
  },
  generic: (fix, facts) => generic(read(fix, facts), facts),
  stacks: {
    nextjs: {
      write: (fix, facts) => nextjs(read(fix, facts), facts),
      sources: [
        {
          title: 'generateMetadata',
          url: NEXT_METADATA,
          read: DOCS_READ,
          supports:
            'metadata and generateMetadata are exported from layout.js and page.js, in Server Components; alternates.canonical and its <link rel="canonical"> output; Merging: objects are shallowly merged and nested fields are overwritten by the last segment to define them, shared through a separate variable or the parent argument; metadataBase composes a relative path; "If the page can be prerendered and generateMetadata doesn\'t introduce dynamic behavior, the resulting metadata is included in the page\'s initial HTML. Otherwise the metadata resolved from generateMetadata can be streamed"; Streaming metadata: tags appended to the <body>, and in the <head> for HTML-limited bots',
        },
        NEXT_LIMITED_BOTS_SOURCE,
      ],
    },
  },
  verify: (fix, facts) => {
    const r = read(fix, facts);
    const own = fetchOf(facts, [r.page]);
    const expected = servedAt(facts, r.expected);
    const canonical = r.stands ? null : canonicalIs(expected);
    const [linker] = r.linking;
    // a link to the canonical that the programs read as a link to the page cannot be told from the
    // old one (html-checks.ts `sameInCommand`): the links are then left to the next check
    const told = r.linksTo !== null && !sameInCommand(r.linksTo, r.page);
    const moved =
      r.linksTo === null || linker === undefined || !told
        ? null
        : {
            from: readShown(facts, linker),
            to: servedAt(facts, r.linksTo),
            linker,
            links: (page: number) => linksTo(addressesOf(facts, r.linksTo!), [r.page], page),
          };
    const more = ours(
      r.linking.length > 1 ? ' The command reads the first linking page: run it for each.' : '',
    );
    const untold = ours(
      r.linksTo !== null && !told
        ? ' The command cannot tell a link to the one URL from a link to the other, so the links are measured on the next check.'
        : '',
    );
    const seeCanonical: See = {
      command: seeTags(facts, [r.page], TAGS.canonical),
      today: line`The page's canonical tag, which names ${code(r.declared)}.`,
      after: line`The page's canonical tag, naming ${code(expected)}.`,
    };
    if (canonical !== null && moved !== null) {
      return {
        // one request for the two pages: the page first, then the page that links to it
        command: command(
          fetchOf(facts, [r.page, moved.linker]).fragment,
          holds(canonicalIs(expected, 1), moved.links(2)),
        ),
        // short, and with each URL once: a line past its bound is cut, and the limits are at its end
        expect: line`Exit status 0 once the <head> of ${readShown(facts, r.page)} holds one <link rel="canonical">, naming ${code(expected)} (today: ${code(r.declared)}), and ${moved.from} links to that URL and no longer to this page, however a URL is written. ${NOT_READ} ${UNREAD_HREF}${more}`,
        ua: own.ua,
        see: seeCanonical,
      };
    }
    if (canonical !== null) {
      return {
        command: command(own.fragment, holds(canonical)),
        expect: line`Exit status 0 once the <head> of ${readShown(facts, r.page)} holds one <link rel="canonical">, naming ${code(expected)}, however the URL is written. Today it names ${code(r.declared)}. ${NOT_READ}${untold}`,
        ua: own.ua,
        see: seeCanonical,
      };
    }
    if (moved === null || linker === undefined || r.linksTo === null) {
      if (linker === undefined || r.linksTo === null) {
        throw new Error('packets: a canonical_mismatch record proves no fault and no link');
      }
      // the canonical stands and the links cannot be told apart: the command shows the canonical,
      // which is there today, and its `expect` says what it cannot show
      return {
        command: command(own.fragment, holds(canonicalIs(expected))),
        expect: line`Exit status 0 while the <head> of ${readShown(facts, r.page)} holds one <link rel="canonical">, naming ${code(expected)}, which it does today: the fix is to the links, and the command cannot tell a link to ${code(r.own)} from a link to ${code(expected)}. The links are measured on the next check.`,
        ua: own.ua,
        see: seeCanonical,
      };
    }
    return {
      command: command(fetchOf(facts, [moved.linker]).fragment, holds(moved.links(1))),
      expect: line`Exit status 0 once ${moved.from} links to ${code(moved.to)} and no longer to ${code(r.own)} (an <a> href, however the URL is written). Today it links to ${code(r.own)}. ${UNREAD_HREF}${more}`,
      ua: own.ua,
      see: {
        command: seeTags(facts, [linker], TAGS.a, [pathWord(r.page), pathWord(r.linksTo)]),
        today: line`The <a> tags that link to ${code(r.own)}: lines that hold ${code(pathOf(r.page))}.`,
        after: line`The <a> tags that link to ${code(moved.to)}, lines that hold ${code(pathOf(r.linksTo))}, and none that links to ${code(r.own)}.`,
      },
    };
  },
};
