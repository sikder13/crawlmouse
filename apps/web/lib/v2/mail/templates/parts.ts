/**
 * The pieces the templates build their HTML from. Every text argument is escaped here; every href is
 * a URL from `../links.ts`, which builds them from our origin, our paths and values of a known shape.
 */
import { html, oneLine } from '../escape';

/** Longest host a message shows: longer than any real one (253), shorter than a hostile one. */
export const HOST_MAX = 100;

/** A host as one line of text, bounded. Shown as text only, never as a link. */
export const hostText = (host: string): string => oneLine(host, HOST_MAX);

/** Longest account or agency name a message shows. */
export const ACCOUNT_NAME_MAX = 80;

/**
 * What a mail client may turn into a link when it meets it in plain text. The rule refuses more
 * than clients link, and says so: `@`, `:`, `/` and `\\` anywhere (an address, a scheme, a path); a
 * dot, or one of the three dots a host name's are folded from (U+FF0E, U+3002, U+FF61), with a
 * character straight after it (`example.com`, `1.2.3.4`, and also "Node.js"); an
 * invisible format character, which can split a host a filter would see; and seven digits or more,
 * with or without separators (a telephone number).
 */
const LINKABLE = /[@:/\\]|[.\uFF0E\u3002\uFF61](?=\S)|\p{Cf}|(?:\d[\s().+-]*){7,}/u;

/**
 * An account's name, which its owner typed, as one bounded line; null when it has none, and null
 * when it holds text of a shape a mail client may link (`LINKABLE`): the name goes to an address
 * its owner chose, so a message shows it only as a name. A template then writes what it writes for
 * an account with no name. An ordinary name with a dot inside a word is not shown either.
 */
export function accountNameText(name: string | null): string | null {
  const line = oneLine(name ?? '', ACCOUNT_NAME_MAX);
  return line === '' || LINKABLE.test(line) ? null : line;
}

/** One paragraph of plain text. */
export const para = (text: string): string => `<p>${html(text)}</p>`;

/** A paragraph that is one link: `url` from links.ts, `label` plain text. */
export const linkPara = (url: string, label: string): string =>
  `<p><a href="${html(url)}">${html(label)}</a></p>`;

/** Preformatted text, kept as written: a packet's lines. */
export const pre = (text: string): string =>
  `<pre style="white-space:pre-wrap;word-break:break-word;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">${html(text)}</pre>`;

const SMALL = 'font-size:13px;opacity:.8';

/** A quieter closing line. */
export const small = (text: string): string => `<p style="${SMALL}">${html(text)}</p>`;

/** A quieter closing line that is one link: `url` from links.ts, `label` plain text. */
export const smallLink = (url: string, label: string): string =>
  `<p style="${SMALL}"><a href="${html(url)}">${html(label)}</a></p>`;
