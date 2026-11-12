/**
 * canonical_mismatch: a page whose rel=canonical cannot be honoured, or that the site links to under
 * a URL that is not its canonical (detectors/canonical-mismatch.ts). A record proves at most one
 * fault of the canonical's target, and, apart from it, that pages link to the non-canonical URL.
 *
 * What the canonical should be (`expectedOf`) is read from the check's rows, never assumed:
 *   - the target is on another host, gone, or disallowed for search: the page's own URL;
 *   - the target redirects: where it landed, when that page answered 200 and declares itself or no
 *     canonical; otherwise the page's own URL;
 *   - the target declares another canonical: that URL, when the check holds it answering 200 at
 *     itself and declaring itself or none; otherwise the page's own URL;
 *   - no fault of the target (links only): the canonical stands, and the links move to it.
 * Links to the page move too whenever the expected canonical is another URL than the page.
 *
 * Verify reads the page's first `<link rel="canonical">` for the expected URL, and, when links move, a
 * linking page for a link to the canonical and none to the page.
 */
import type { PageResult } from '@crawlmouse/types/v2';
import { SEARCH_ENGINES } from '../../detectors/scope.js';
import type { Condition } from '../../detectors/types.js';
import {
  ANCHOR_HREFS,
  anyOf,
  both,
  CANONICAL_HREF,
  command,
  fetchOf,
  hrefForms,
  joined,
  movedTo,
  spelled,
} from '../html-checks.js';
import { DOCS_READ, GOOGLE_DOCS, pagesShown, plural, rowOf, subjectOf } from '../structure.js';
import { code, count, line, list, ours, type Line } from '../text.js';
import type { Change, PacketEntry, PacketFacts, RecordOf } from '../types.js';

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

interface Reading {
  page: string;
  /** The canonical the page declares, as resolved. */
  declared: string;
  /** The crawled row that answered at the canonical's target; null when the check holds none. */
  at: PageResult | null;
  /** The fault of the canonical's target the record proves; null when it proves none. */
  fault: Condition | null;
  /** The pages that link to the page, when the record proves that. */
  linking: string[];
  /** What the page's canonical should be. */
  expected: string;
  /** Where the links to the page should go; null when they stay. */
  linksTo: string | null;
}

function expectedOf(
  page: string,
  declared: string,
  at: PageResult | null,
  fix: Fix,
  facts: PacketFacts,
) {
  const fault = fix.conditions.find((c) => c !== LINKED) ?? null;
  if (fault === null) return declared;
  if (fault === 'canonical_target_redirects' && at !== null && at.status_code === 200) {
    const landed = at.final_url === null ? null : spelled(at.final_url);
    if (landed !== null && declaresItself(at, landed)) return landed;
  }
  if (fault === 'canonical_target_not_canonical') {
    const next = declaredBy(at);
    const row = next === null ? undefined : facts.pages.get(spelled(next));
    if (
      row !== undefined &&
      row.status_code === 200 &&
      row.final_url !== null &&
      spelled(row.final_url) === row.url &&
      declaresItself(row, row.url)
    ) {
      return row.url;
    }
  }
  return page;
}

function read(fix: Fix, facts: PacketFacts): Reading {
  const page = subjectOf(fix);
  const declared = declaredBy(rowOf(facts, page));
  if (declared === null) {
    throw new Error('packets: a canonical_mismatch record names a page that declares no canonical');
  }
  const other = fix.evidence.pages.find((p) => p !== page);
  const at = other === undefined ? null : (facts.pages.get(other) ?? null);
  const expected = expectedOf(page, declared, at, fix, facts);
  const linked = fix.conditions.includes(LINKED);
  const linking = linked ? [...new Set(fix.evidence.edges.map((e) => e.from_url))] : [];
  return {
    page,
    declared,
    at,
    fault: fix.conditions.find((c) => c !== LINKED) ?? null,
    linking,
    expected,
    linksTo: linking.length > 0 && expected !== page ? expected : null,
  };
}

/** One sentence for a condition the record proves, from the rows it names. */
function sentence(condition: Condition, r: Reading): Line[] {
  const target = code(r.declared);
  switch (condition) {
    case 'canonical_cross_host':
      return [
        line`${target} is on another host than the page: the canonical asks search engines to index that URL in place of this one.`,
      ];
    case 'canonical_target_redirects':
      if (r.at === null || r.at.final_url === null) return [line`${target} redirects.`];
      return [
        r.at.status_code === 200
          ? line`${target} redirects to ${code(r.at.final_url)}.`
          : line`${target} is a redirect: the crawl's request for it ended with status ${count(r.at.status_code)}.`,
      ];
    case 'canonical_target_gone':
      return [
        r.at === null
          ? line`${target} is gone.`
          : line`${target} answers ${count(r.at.status_code)}: the page the canonical names is gone.`,
      ];
    case 'canonical_target_not_canonical': {
      const next = declaredBy(r.at);
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
        line`${count(r.linking.length)} ${plural(r.linking.length, 'page links', 'pages link')} to ${code(r.page)}, a URL that names another as its canonical: ${pagesShown(r.linking)}.`,
      ];
    default:
      return [];
  }
}

/** The step that moves the links, when they move. */
function linkSteps(r: Reading): Line[] {
  if (r.linksTo === null) return [];
  return [
    line`Change the links to ${code(r.page)} on ${pagesShown(r.linking)} so that they point at ${code(r.linksTo)}: Google asks that internal links go to the canonical URL, not to a duplicate.`,
    ...(r.fault === null
      ? [
          line`If ${code(r.page)} is meant to be indexed in its own right, make its canonical its own URL instead; the command below checks the links.`,
        ]
      : []),
  ];
}

function keepOf(r: Reading): Line[] {
  return [
    line`Keep ${code(r.page)} answering 200 with its content: no redirect is asked for.`,
    ...(r.linking.length > 0 && r.linksTo === null
      ? [
          line`Keep the links to ${code(r.page)}: once it is its own canonical they point at the canonical URL.`,
        ]
      : []),
  ];
}

/** The step that sets the canonical, with why that URL. */
function canonicalStep(r: Reading): Line[] {
  if (r.fault === null) return [];
  if (r.expected === r.page) {
    return [
      line`Set the rel="canonical" of ${code(r.page)} to its own URL.`,
      line`If another live URL of this site is the one meant to be indexed for this content, name that one instead; the command below checks for the page's own URL.`,
    ];
  }
  return [
    r.fault === 'canonical_target_redirects'
      ? line`Set the rel="canonical" of ${code(r.page)} to ${code(r.expected)}, where ${code(r.declared)} lands.`
      : line`Set the rel="canonical" of ${code(r.page)} to ${code(r.expected)}, the canonical that ${code(r.declared)} itself declares.`,
  ];
}

const generic = (r: Reading): Change => ({
  change: [
    ...canonicalStep(r),
    ...(r.fault === null
      ? []
      : [line`Write it as one <link rel="canonical"> in the <head>, with an absolute URL.`]),
    ...linkSteps(r),
  ],
  keep: keepOf(r),
});

const NEXT_METADATA = 'https://nextjs.org/docs/app/api-reference/functions/generate-metadata';

/** The Next.js body: where the tag comes from in the App Router. None when the canonical stands. */
function nextjs(r: Reading): Change | null {
  if (r.fault === null) return null;
  return {
    change: [
      r.expected === r.page
        ? line`In the App Router the tag comes from alternates.canonical in the metadata export, or in generateMetadata, of the page.js of the route or of a layout.js above it. Set it there so that ${code(r.page)} declares its own URL.`
        : line`In the App Router the tag comes from alternates.canonical in the metadata export, or in generateMetadata, of the page.js of the route or of a layout.js above it. Set it there so that ${code(r.page)} declares ${code(r.expected)}.`,
      line`A route that sets no alternates of its own takes the alternates of the layout above it. If the wrong canonical comes from a layout, set alternates.canonical in the page's own metadata.`,
      line`Give an absolute URL, or a path with metadataBase set in the root layout: Next.js joins the two.`,
      ...(r.expected === r.page
        ? [
            line`If another live URL of this site is the one meant to be indexed for this content, name that one instead; the command below checks for the page's own URL.`,
          ]
        : []),
      ...linkSteps(r),
    ],
    keep: keepOf(r),
  };
}

export const canonicalMismatch: PacketEntry<'canonical_mismatch'> = {
  kind: 'builder',
  context: (fix, facts) => {
    const r = read(fix, facts);
    return [
      line`${code(r.page)} declares ${code(r.declared)} as its canonical.`,
      ...fix.conditions.flatMap((c) => sentence(c, r)),
      line`Google's rules for canonical URLs: ${ours(GOOGLE_DOCS.canonical)}`,
    ];
  },
  generic: (fix, facts) => generic(read(fix, facts)),
  stacks: {
    nextjs: {
      write: (fix, facts) => nextjs(read(fix, facts)),
      sources: [
        {
          title: 'generateMetadata',
          url: NEXT_METADATA,
          read: DOCS_READ,
          supports:
            'alternates.canonical in the metadata export or generateMetadata of layout.js and page.js; a route inherits a field it does not set; metadataBase',
        },
      ],
    },
  },
  verify: (fix, facts) => {
    const r = read(fix, facts);
    const own = fetchOf(facts, [r.page]);
    const canonical =
      r.fault === null ? null : joined(own.fragment, CANONICAL_HREF, anyOf(hrefForms(r.expected)));
    const [linker] = r.linking;
    const links =
      r.linksTo === null || linker === undefined
        ? null
        : joined(
            fetchOf(facts, [linker]).fragment,
            ANCHOR_HREFS,
            movedTo(hrefForms(r.page), hrefForms(r.linksTo)),
          );
    const more = ours(
      r.linking.length > 1 ? ' The command reads the first linking page: run it for each.' : '',
    );
    if (canonical !== null && links !== null && r.linksTo !== null && linker !== undefined) {
      return {
        command: command(both(canonical, links)),
        expect: line`Exit status 0 once the first <link rel="canonical"> of ${code(r.page)} names ${code(r.expected)} (today: ${code(r.declared)}), and ${code(linker)} links to ${code(r.linksTo)} and no longer to ${code(r.page)}. A URL counts in full or from the root, in quotes.${more}`,
        ua: own.ua,
      };
    }
    if (canonical !== null) {
      return {
        command: command(canonical),
        expect: line`Exit status 0 once the first <link rel="canonical"> of ${code(r.page)} names ${code(r.expected)}, in full or from the root, in quotes. Today it names ${code(r.declared)}.`,
        ua: own.ua,
      };
    }
    if (links === null || r.linksTo === null || linker === undefined) {
      throw new Error('packets: a canonical_mismatch record proves no fault and no link');
    }
    return {
      command: command(links),
      expect: line`Exit status 0 once ${code(linker)} links to ${code(r.linksTo)} and no longer to ${code(r.page)} (an <a> href in full or from the root, in quotes). Today it links to ${code(r.page)}.${more}`,
      ua: own.ua,
    };
  },
};
