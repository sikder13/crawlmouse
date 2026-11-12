/**
 * What the five content packets share: the lines that state a template's extent from its record, and
 * the shape of their verify command.
 *
 * A content record (content/aggregate.ts `ContentDetection`) holds a template key, how many of its
 * decided pages fail, how many were not read, and the failing pages. It does not hold what each page
 * says, so a packet states the check's rule (from content/thresholds.ts) and names the pages; it
 * quotes nothing from them.
 */
import type { ContentDetection } from '../content/aggregate.js';
import { CONTENT_CHECKS } from '../content/checks.js';
import { CHROME } from '../content/thresholds.js';
import { userAgentOf, verifyCrawler } from './crawler.js';
import { readAt, servedAt } from './served-at.js';
import { sh, url, word, type Command } from './shell.js';
import { code, count, line, list, ours, type Line, type Safe } from './text.js';
import type { PacketFacts } from './types.js';

/** The date the documentation pages the content packets cite were read. */
export const DOCS_READ = '2026-11-12';

/** How many failing pages a packet names before it counts the rest. */
export const EXAMPLE_PAGES = 3;
/** The longest URL and template key a content packet shows, in code points. */
export const URL_CHARS = 120;
export const TEMPLATE_CHARS = 80;

/** Markup or a value this repository wrote, in a code span. */
export function mark(text: string): Safe {
  if (text.includes('`')) throw new Error('packets: markup of ours holds a backtick');
  return ours(`\`${text}\``);
}

/** The elements the content checks set aside before they read a page (thresholds.ts CHROME). */
export const SET_ASIDE = mark(CHROME);

export const template = (fix: ContentDetection): Safe => code(fix.template_key, TEMPLATE_CHARS);

const pages = (n: number): Safe => ours(n === 1 ? 'page' : 'pages');

/** The page a content packet's command requests: the first failing page of the record. */
export function firstFailingPage(fix: ContentDetection): string {
  const [first] = fix.affected_urls;
  if (first === undefined) {
    throw new Error('packets: a content packet is written for a record with a failing page');
  }
  return first;
}

/** Whether the check counts in a grade, as its definition says (content/checks.ts `scored`). */
export function gradeLine(scored: boolean): Line {
  return scored
    ? line`The check counts in the Quotable part of the AI readability grade.`
    : line`The check does not count towards a grade yet, so this fix moves no grade today.`;
}

/**
 * A content packet's context: the extent from the record, the check's rule (the caller's lines),
 * the pages not read when there are any, the failing pages at the address each is served at
 * (served-at.ts), and whether the check is graded.
 */
export function contentContext(
  fix: ContentDetection,
  facts: PacketFacts,
  rule: readonly Line[],
): Line[] {
  const { failing, of, unread } = fix.extent;
  return [
    line`The check ${code(fix.check)} fails on ${count(failing)} of the ${count(of)} ${pages(of)} of the template ${template(fix)} it was decided on.`,
    ...rule,
    ...(unread > 0
      ? [
          line`${count(unread)} more ${pages(unread)} of the template could not be read for this check and ${ours(unread === 1 ? 'is' : 'are')} not counted.`,
        ]
      : []),
    line`Failing ${pages(fix.affected_urls.length)}: ${list(
      fix.affected_urls.map((u) => code(servedAt(facts, u), URL_CHARS)),
      EXAMPLE_PAGES,
      'page',
    )}.`,
    gradeLine(CONTENT_CHECKS[fix.check].scored),
  ];
}

/** What every content packet keeps. */
export const KEEP_PAGE = line`Keep each page's URL and its H1.`;

export interface TagProbe {
  command: Command;
  /** The registry token of the crawler requested as; null when the command requests as none. */
  ua: string | null;
  /** Who the command requests as, as a sentence for `expect`. */
  sender: Safe;
}

const SELECTORS = CHROME.split(', ');
/** The set-aside selectors that are element names, which a tag-by-tag read can follow. */
const CHROME_ELEMENTS = SELECTORS.filter((s) => /^[a-z]+$/.test(s));
/** The rest (attribute selectors), which it cannot. */
const CHROME_ATTRIBUTES = SELECTORS.filter((s) => !CHROME_ELEMENTS.includes(s));

/**
 * The opening rules of an awk program that reads visible markup, after `tagProbe`'s split: `l` is the
 * line in lower case, and `c` counts the set-aside elements open at it, so a rule guarded by `!c`
 * skips what is inside one.
 */
export const AWK_VISIBLE = `{l=tolower($0)}l~/^(${CHROME_ELEMENTS.join('|')})[ \\t>]/{c++}l~/^\\/(${CHROME_ELEMENTS.join('|')})>/{if(c)c--}`;

/** For `expect`: how far a command built on AWK_VISIBLE follows the check's set-aside list. */
export const CHROME_GAP = ours(
  `The command sets aside \`${CHROME_ELEMENTS.join(', ')}\` elements as the check does, but not \`${CHROME_ATTRIBUTES.join(', ')}\`.`,
);

/** For `expect`: the command reads one page; the audit's next check is the full proof. */
export const RECHECK = ours(
  "The audit's next check applies the full rule to every page of the template.",
);

/**
 * The command of a content packet: fetch the page at the address the crawl read it at (served-at.ts
 * `readAt`), put each tag on its own line (`tr` turns line
 * breaks into spaces and each `<` into a line break, so a line starts with a tag's name and holds the
 * text up to the next tag), and let `program`, an awk program of ours, exit 0 when what it looks for
 * is there. Requested as a crawler the site serves today (crawler.ts), or as none when the audit
 * recorded none.
 */
export function tagProbe(facts: PacketFacts, page: string, program: string): TagProbe {
  const from = word('\\r\\n<');
  const to = word('  \\n');
  const entry = verifyCrawler(facts);
  const address = url(readAt(facts, page));
  if (entry === null) {
    return {
      command: sh`curl -sS ${address} | tr ${from} ${to} | awk ${word(program)}`,
      ua: null,
      sender: ours(
        "It requests with curl's own user agent: the audit recorded no crawler the site serves.",
      ),
    };
  }
  return {
    command: sh`curl -sS -A ${word(userAgentOf(entry))} ${address} | tr ${from} ${to} | awk ${word(program)}`,
    ua: entry.token,
    sender: ours(`It requests as ${entry.token}, which the site serves today.`),
  };
}

/**
 * awk rules that undo `tagProbe`'s split inside a script element, for a program that reads one: from
 * a script's opening tag to its closing tag the lines are joined with the `<` the split took (`J`),
 * and the rules after these see the element as one line. So a `<` in a JSON-LD block's text does not
 * end the block, and a tag's name in a script's text is not read as a tag. `Q` marks the joined line,
 * so it is not taken for an opening tag again. A script that is not closed gives no line.
 */
export const AWK_SCRIPTS =
  '{Q=0}J!=""{if(tolower($0)~/^\\/script[ \\t>]/){$0=J;J="";Q=1}else{J=J"<"$0;next}}' +
  '!Q&&tolower($0)~/^script[ \\t>]/{J=$0;next}';

/** awk, after `tagProbe`'s split and AWK_SCRIPTS: this line is a JSON-LD script block. */
export const LD_BLOCK = 'tolower($0)~/^script[^>]*application\\/ld\\+json/';

/** awk: the text a line holds after its tag, into `x`. */
export const AWK_TEXT = 'x=$0;sub(/^[^>]*>/,"",x)';

/**
 * An awk regular expression (without its slashes) for a JSON-LD `@type` whose value, or one of whose
 * listed values, is one of `names` (an alternation), with or without the schema.org prefix.
 */
export const ldType = (names: string): string =>
  `"@type"[ \\t]*:[ \\t]*(\\[[^]]*)?"(https?:\\/\\/schema\\.org\\/)?(${names})"`;
