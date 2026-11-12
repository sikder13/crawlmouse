/**
 * The pieces the templates build their HTML from. Every text argument is escaped here; every href is
 * a URL from `../links.ts`, which builds them from our origin, our paths and values of a known shape.
 */
import { html, oneLine } from '../escape';

/** Longest host a message shows: longer than any real one (253), shorter than a hostile one. */
export const HOST_MAX = 100;

/** A host as one line of text, bounded. Shown as text only, never as a link. */
export const hostText = (host: string): string => oneLine(host, HOST_MAX);

/** One paragraph of plain text. */
export const para = (text: string): string => `<p>${html(text)}</p>`;

/** A paragraph that is one link: `url` from links.ts, `label` plain text. */
export const linkPara = (url: string, label: string): string =>
  `<p><a href="${html(url)}">${html(label)}</a></p>`;

/** Preformatted text, kept as written: a packet's lines. */
export const pre = (text: string): string =>
  `<pre style="white-space:pre-wrap;word-break:break-word;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">${html(text)}</pre>`;

/** A quieter closing line. */
export const small = (text: string): string =>
  `<p style="font-size:13px;opacity:.8">${html(text)}</p>`;
