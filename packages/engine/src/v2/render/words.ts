/**
 * The one word count both sides of a page use: the engine's main-content extraction on the HTML, then
 * runs of non-space characters. Both sides call `mainWords`, so they are counted the same way.
 *
 * Block boundaries are made word boundaries first. `extractMainContent` joins text nodes as they are,
 * so `<h1>Ridge tent</h1><p>Two person</p>` reads "Ridge tentTwo person": three words, not four. Markup
 * a script builds usually has no whitespace between tags, and markup a server writes often has some,
 * so without this the rendered side of a client-rendered page would lose a word at each block.
 *
 * Only the elements in BOUNDARY_ELEMENTS are split. Text in adjacent inline elements with nothing
 * between them (`<span>Ridge</span><span>tent</span>`) stays one word, as a browser shows it.
 *
 * The split is one pass over the HTML string: a space is written before each opening or closing tag of
 * a boundary element. Where such a tag is not markup the space lands there instead: in a script, a
 * comment or an attribute value, or in text the extractor does count (a `<textarea>`, an `<xmp>`),
 * where it can split a word. Both sides get the same treatment.
 */
import * as cheerio from 'cheerio';
import { extractMainContent } from '../../analysis/ai-readiness/main-content.js';

/** Elements a browser lays out as their own block, line or box, so text either side is a separate word. */
export const BOUNDARY_ELEMENTS = [
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'button',
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
  'img',
  'input',
  'legend',
  'li',
  'main',
  'nav',
  'ol',
  'option',
  'p',
  'pre',
  'section',
  'select',
  'summary',
  'table',
  'tbody',
  'td',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
] as const;

const BOUNDARY_TAG = new RegExp(`<(/?)(${BOUNDARY_ELEMENTS.join('|')})(?=[\\s/>])`, 'gi');

export const countWords = (text: string): number => text.match(/\S+/g)?.length ?? 0;

export function mainWords(html: string): number {
  const $ = cheerio.load(html.replace(BOUNDARY_TAG, ' <$1$2'));
  return countWords(extractMainContent($).text);
}
