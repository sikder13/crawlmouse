/**
 * What the content checks read of one page's static HTML, as features that hold no page text: the
 * shape of the text after its title heading, its section headings, its JSON-LD, its byline markup and
 * how it shows specifications. Read from the page as served, without running scripts. A page served
 * for JavaScript to fill in (client_rendered) keeps its JSON-LD and byline markup; its text features
 * are empty.
 *
 * Site chrome (CHROME) is set aside first, so a menu's links and headings are not taken for the
 * page's own. A <header> is kept: on article templates it holds the H1.
 */
import * as cheerio from 'cheerio';
import { looksJsRendered } from '../../analysis/js-detect.js';
import {
  ANSWER_SENTENCE_WORDS,
  CHROME,
  MIN_BLOCK_WORDS,
  OPENING_BLOCKS,
  OPENING_WORDS,
  PROSE_BLOCKS,
  QUESTION_MARK,
  SPEC_IMAGE,
  SPEC_LINE,
  SPEC_LINE_BLOCKS,
} from './thresholds.js';

/** One JSON-LD node, flattened out of arrays and @graph. */
export interface JsonLdNode {
  types: string[];
  has_description: boolean;
  has_author: boolean;
  /** datePublished is present and names a four-digit year. */
  has_dated_publication: boolean;
}

/** A block of text after the H1, in document order. */
export interface Block {
  /** The element: p, li, h2, … */
  tag: string;
  words: number;
  /** Sentences in the block that are statements of ANSWER_SENTENCE_WORDS words ending in a full stop. */
  answer_sentences: number;
  /** A clause of the block ends as a question. */
  question: boolean;
}

export interface ContentFeatures {
  /**
   * Served for JavaScript to fill in: the page looks like an app shell (v1's looksJsRendered) and has
   * no H1 with text, or under MIN_BLOCK_WORDS words after it. Its text features are then empty.
   */
  client_rendered: boolean;
  /** An H1 with text exists. */
  has_h1: boolean;
  /** Words in the text blocks after the first H1 with text. */
  words_after_h1: number;
  /** Those blocks, up to and including the one that reaches OPENING_WORDS words. */
  opening: Block[];
  /**
   * After the H1: `count` is the section headings (an h2 or h3 followed by a prose block of
   * MIN_BLOCK_WORDS words); `questions` is every h2 or h3 phrased as a question, section heading or
   * not, so a related-post title outside CHROME that asks a question counts. Counting only section
   * headings was measured against the label set on 2026-11-03 and more of its firings were wrong; the
   * counts are in the CC-17 pull request.
   */
  headings: {
    count: number;
    questions: number;
    /**
     * Of the section headings, those phrased as a question. No check reads it: the label set measures
     * the rule that counts only these against the one question_headings uses (SPEC 17).
     */
    section_questions: number;
  };
  json_ld: JsonLdNode[];
  byline: {
    meta_author: boolean;
    published_time: boolean;
    rel_author: boolean;
    itemprop_author: boolean;
    itemprop_date: boolean;
    time_datetime: boolean;
  };
  specs: {
    /** Tables and description lists outside site chrome. */
    structured: number;
    /** Distinct "Label: value" lines with a digit in the value. */
    label_value_lines: number;
    /** Images that look like specifications and are not links to another page. */
    spec_images: number;
  };
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
export const wordsIn = (s: string): number => (s ? s.split(' ').length : 0);

/** A statement of ANSWER_SENTENCE_WORDS words, ending in a full stop, a closing quote or bracket after it allowed. */
export function isAnswerSentence(sentence: string): boolean {
  const n = wordsIn(sentence);
  return (
    /\.["'”’)\]»]*$/.test(sentence) &&
    n >= ANSWER_SENTENCE_WORDS.min &&
    n <= ANSWER_SENTENCE_WORDS.max
  );
}

/** A JSON-LD type with any schema.org IRI prefix removed: `https://schema.org/Product` is `Product`. */
const typeName = (t: string) => t.replace(/^https?:\/\/schema\.org\//, '');

/** The last path segment of an image URL, percent-decoded where it decodes. */
function fileName(src: string): string {
  const last = src.split(/[?#]/)[0]!.split('/').pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function jsonLd($: cheerio.CheerioAPI): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (Array.isArray(o['@graph'])) (o['@graph'] as unknown[]).forEach(visit);
    visit(o.mainEntity);
    const type = o['@type'];
    const types = (Array.isArray(type) ? type : [type])
      .filter((t): t is string => typeof t === 'string')
      .map(typeName);
    if (types.length === 0) return;
    const author = o.author;
    nodes.push({
      types,
      has_description: typeof o.description === 'string' && o.description.trim() !== '',
      has_author:
        typeof author === 'string'
          ? author.trim() !== ''
          : Array.isArray(author)
            ? author.length > 0
            : !!author && typeof author === 'object',
      has_dated_publication: typeof o.datePublished === 'string' && /\d{4}/.test(o.datePublished),
    });
  };
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      visit(JSON.parse($(s).text()));
    } catch {
      // markup that does not parse declares nothing
    }
  });
  return nodes;
}

/** The blocks up to and including the one that reaches OPENING_WORDS words. */
function openingWindow(blocks: readonly Block[]): Block[] {
  let read = 0;
  const end = blocks.findIndex((b) => (read += b.words) >= OPENING_WORDS);
  return blocks.filter((_, i) => end === -1 || i <= end);
}

const isHeading = (b: Block) => b.tag === 'h2' || b.tag === 'h3';

export function readPage(html: string): ContentFeatures {
  const $ = cheerio.load(html);
  const json_ld = jsonLd($);
  const served = looksJsRendered(html);
  $('script, style, noscript, template, svg').remove();
  $(CHROME).remove();
  const body = $('body');
  const byline = {
    meta_author: !!$('meta[name="author"]').attr('content')?.trim(),
    published_time: !!$('meta[property="article:published_time"]').attr('content')?.trim(),
    rel_author: $('a[rel~="author"], link[rel~="author"]').length > 0,
    itemprop_author: body.find('[itemprop="author"]').length > 0,
    itemprop_date: body.find('[itemprop="datePublished"]').length > 0,
    time_datetime: body.find('time[datetime]').length > 0,
  };

  // A block that holds another reading block is read through the inner one, so its text counts once.
  const holders = new Set<unknown>();
  body.find([...OPENING_BLOCKS].join(',')).each((_, el) => {
    for (let p = el.parent; p && p !== body[0]; p = p.parent) holders.add(p);
  });
  const h1 = body
    .find('h1')
    .filter((_, e) => squash($(e).text()) !== '')
    .first();
  const blocks: Block[] = [];
  if (h1.length) {
    let after = false;
    body.find('*').each((_, el) => {
      if (el === h1[0]) after = true;
      else if (after && OPENING_BLOCKS.has(el.tagName) && !holders.has(el)) {
        const text = squash($(el).text());
        if (!text) return;
        blocks.push({
          tag: el.tagName,
          words: wordsIn(text),
          answer_sentences: text.split(/(?<=[.!?؟]["'”’)\]»]*)\s+/).filter(isAnswerSentence).length,
          question: QUESTION_MARK.test(text),
        });
      }
    });
  }
  const words_after_h1 = blocks.reduce((n, b) => n + b.words, 0);

  // Served for JavaScript to fill in: the page looks like an app shell and has no title and text of its own.
  if (served && (h1.length === 0 || words_after_h1 < MIN_BLOCK_WORDS)) {
    return {
      client_rendered: true,
      has_h1: false,
      words_after_h1: 0,
      opening: [],
      headings: { count: 0, questions: 0, section_questions: 0 },
      json_ld,
      byline,
      specs: { structured: 0, label_value_lines: 0, spec_images: 0 },
    };
  }
  const headings = blocks.filter((b, i) => {
    const next = blocks[i + 1];
    return (
      isHeading(b) &&
      next !== undefined &&
      PROSE_BLOCKS.has(next.tag) &&
      next.words >= MIN_BLOCK_WORDS
    );
  });
  const lines = body
    .find(SPEC_LINE_BLOCKS)
    .map((_, e) => squash($(e).text()))
    .get();
  return {
    client_rendered: false,
    has_h1: h1.length > 0,
    words_after_h1,
    opening: openingWindow(blocks),
    headings: {
      count: headings.length,
      questions: blocks.filter((b) => isHeading(b) && b.question).length,
      section_questions: headings.filter((b) => b.question).length,
    },
    json_ld,
    byline,
    specs: {
      structured: body.find('table, dl').length,
      label_value_lines: new Set(lines.filter((l) => SPEC_LINE.test(l))).size,
      spec_images: body.find('img').filter((_, img) => {
        if ($(img).closest('a[href]').length > 0) return false;
        return SPEC_IMAGE.test(`${$(img).attr('alt') ?? ''} ${fileName($(img).attr('src') ?? '')}`);
      }).length,
    },
  };
}
