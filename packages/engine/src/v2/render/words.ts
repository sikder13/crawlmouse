/**
 * The one word count both sides of a page use: the engine's main-content extraction on the HTML, then
 * runs of non-space characters. The share is honest only if the two sides are counted the same way,
 * so there is no second path.
 *
 * Block boundaries are made word boundaries first. `extractMainContent` joins text nodes as they are,
 * so `<h1>Ridge tent</h1><p>Two person</p>` reads "Ridge tentTwo person": three words, not four. Markup
 * a script builds usually has no whitespace between tags, and markup a server writes often has some,
 * so without this the rendered side of a client-rendered page would lose a word at every block and its
 * share would read higher than it is.
 */
import * as cheerio from 'cheerio';
import { extractMainContent } from '../../analysis/ai-readiness/main-content.js';

/** Elements a browser lays out as their own block or line, so text on either side is a separate word. */
export const BLOCK_ELEMENTS = [
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'option',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
] as const;

export const countWords = (text: string): number => text.match(/\S+/g)?.length ?? 0;

export function mainWords(html: string): number {
  const $ = cheerio.load(html);
  $(BLOCK_ELEMENTS.join(',')).before(' ').after(' ');
  return countWords(extractMainContent($).text);
}
