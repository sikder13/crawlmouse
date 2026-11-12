/**
 * Readers the template tests hold a rendered message to: every link target in its HTML, so a test can
 * require each to be one of ours, and every URL written in its text part. A text part is plain text: a
 * crawled string in it (a packet's URLs) is text a mail client may make clickable, which no template
 * can prevent, so `foreignTargets` reads the HTML's targets only.
 *
 * The HTML is read as a browser's tokenizer reads a start tag, not by matching one spelling: a tag
 * name and attribute names in any case, a value double-quoted, single-quoted or unquoted, whitespace
 * (space, tab, CR, LF, form feed) around `=`, and character references in the value (`&#104;`,
 * `&#x68;`, and the named ones in `NAMED`) decoded. Text, comments and `<!…>` / `<?…>` are skipped,
 * so an escaped `&lt;a href=…&gt;` is text, not a link. inspect.test.ts varies each of these.
 *
 * Test support only: nothing in the app imports this file.
 */
import { MAIL_ORIGIN } from '../links';
import type { RenderedMail } from '../types';

/** The attributes whose value a mail client may load or follow. */
export const TARGET_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href',
  'src',
  'srcset',
  'action',
  'formaction',
  'background',
  'poster',
  'cite',
  'data',
  'longdesc',
  'xlink:href',
]);

/** The named references decoded in a value: HTML's for the characters a URL could be spelled with. */
const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  colon: ':',
  sol: '/',
  period: '.',
  tab: '\t',
  newline: '\n',
  lpar: '(',
  rpar: ')',
  equals: '=',
  quest: '?',
  num: '#',
  commat: '@',
  percnt: '%',
};

function decodeReferences(value: string): string {
  return value.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);?/g, (whole, ref: string) => {
    if (ref.startsWith('#')) {
      const hex = ref[1] === 'x' || ref[1] === 'X';
      const n = hex ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

export interface Tag {
  /** The tag name, lower-cased. */
  name: string;
  /** Each attribute as written, its name lower-cased and its value decoded (`''` for a bare name). */
  attributes: ReadonlyArray<readonly [string, string]>;
}

const SPACE = /[\t\n\f\r ]/;
const isSpace = (c: string | undefined): boolean => c !== undefined && SPACE.test(c);

/** Every start tag in the HTML, in order. */
export function startTags(html: string): Tag[] {
  const tags: Tag[] = [];
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    i = lt + 1;
    if (html.startsWith('!--', i)) {
      const end = html.indexOf('-->', i + 3);
      i = end === -1 ? n : end + 3;
      continue;
    }
    const c = html[i] ?? '';
    if (c === '!' || c === '?' || c === '/') {
      const end = html.indexOf('>', i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(c)) continue; // `<` followed by anything else is text.
    let j = i;
    while (j < n && !isSpace(html[j]) && html[j] !== '/' && html[j] !== '>') j++;
    const name = html.slice(i, j).toLowerCase();
    const attributes: Array<[string, string]> = [];
    i = j;
    for (;;) {
      while (i < n && (isSpace(html[i]) || html[i] === '/')) i++;
      if (i >= n || html[i] === '>') {
        i++;
        break;
      }
      // An attribute name may start with `=`; after that it ends at space, `/`, `>` or `=`.
      let k = i + 1;
      while (k < n && !isSpace(html[k]) && !'/>='.includes(html[k]!)) k++;
      const attr = html.slice(i, k).toLowerCase();
      i = k;
      while (i < n && isSpace(html[i])) i++;
      let value = '';
      if (html[i] === '=') {
        i++;
        while (i < n && isSpace(html[i])) i++;
        const q = html[i];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, i + 1);
          value = html.slice(i + 1, end === -1 ? n : end);
          i = end === -1 ? n : end + 1;
        } else {
          let e = i;
          while (e < n && !isSpace(html[e]) && html[e] !== '>') e++;
          value = html.slice(i, e);
          i = e;
        }
      }
      attributes.push([attr, decodeReferences(value)]);
    }
    tags.push({ name, attributes });
  }
  return tags;
}

/** Every link or load target in the HTML (`TARGET_ATTRIBUTES`), decoded, in order. */
export function htmlTargets(html: string): string[] {
  return startTags(html).flatMap((t) =>
    t.attributes.filter(([a]) => TARGET_ATTRIBUTES.has(a)).map(([, v]) => v),
  );
}

/** How many `<a>` and `<area>` elements the HTML has, with or without a target. */
export const anchorCount = (html: string): number =>
  startTags(html).filter((t) => t.name === 'a' || t.name === 'area').length;

/** Every http(s) URL written in the text part. */
export function textUrls(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"]+/gi)].map((m) => m[0]);
}

/**
 * The HTML's targets that are not on our origin: the empty list for a safe message. A target is read
 * as a browser reads a URL attribute: tabs and line breaks dropped, surrounding space trimmed.
 */
export function foreignTargets(mail: RenderedMail): string[] {
  return htmlTargets(mail.html).filter(
    (u) =>
      !u
        .replace(/[\t\n\r]/g, '')
        .trim()
        .startsWith(`${MAIL_ORIGIN}/`),
  );
}
