/**
 * What the content checks read of one page's static HTML, as features that hold no page text: the
 * shape of the text after its title heading, its section headings, its JSON-LD, its byline markup and
 * how it shows specifications. Read from the page as served, without running scripts; a page served
 * for JavaScript to fill in is marked so, and only its JSON-LD and meta tags are read.
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
  /** The page is served as a shell for JavaScript to fill in: its text was not read. */
  client_rendered: boolean;
  /** An H1 with text exists. */
  has_h1: boolean;
  /** Words in the text blocks after the first H1 with text. */
  words_after_h1: number;
  /** Those blocks, up to and including the one that reaches OPENING_WORDS words. */
  opening: Block[];
  /**
   * After the H1: section headings (an h2 or h3 followed by prose) and headings phrased as a question
   * (any h2 or h3: a question is not site chrome).
   */
  headings: { count: number; questions: number };
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

/** A statement of ANSWER_SENTENCE_WORDS words, ending in a full stop. */
export function isAnswerSentence(sentence: string): boolean {
  const n = wordsIn(sentence);
  return /\.$/.test(sentence) && n >= ANSWER_SENTENCE_WORDS.min && n <= ANSWER_SENTENCE_WORDS.max;
}

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
    const type = o['@type'];
    const types = (Array.isArray(type) ? type : [type]).filter(
      (t): t is string => typeof t === 'string',
    );
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

export function readPage(html: string): ContentFeatures {
  const $ = cheerio.load(html);
  const json_ld = jsonLd($);
  const byline = {
    meta_author: !!$('meta[name="author"]').attr('content')?.trim(),
    published_time: !!$('meta[property="article:published_time"]').attr('content')?.trim(),
    rel_author: $('a[rel~="author"], link[rel~="author"]').length > 0,
    itemprop_author: $('[itemprop="author"]').length > 0,
    itemprop_date: $('[itemprop="datePublished"]').length > 0,
    time_datetime: false,
  };
  if (looksJsRendered(html)) {
    return {
      client_rendered: true,
      has_h1: false,
      words_after_h1: 0,
      opening: [],
      headings: { count: 0, questions: 0 },
      json_ld,
      byline,
      specs: { structured: 0, label_value_lines: 0, spec_images: 0 },
    };
  }
  $('script, style, noscript, template, svg').remove();
  $(CHROME).remove();
  const body = $('body');
  byline.time_datetime = body.find('time[datetime]').length > 0;

  const h1 = body
    .find('h1')
    .filter((_, e) => squash($(e).text()) !== '')
    .first();
  const blocks: Block[] = [];
  if (h1.length) {
    let after = false;
    body.find('*').each((_, el) => {
      if (el === h1[0]) after = true;
      else if (after && OPENING_BLOCKS.has(el.tagName)) {
        const text = squash($(el).text());
        if (!text) return;
        blocks.push({
          tag: el.tagName,
          words: wordsIn(text),
          answer_sentences: text.split(/(?<=[.!?؟])\s+/).filter(isAnswerSentence).length,
          question: QUESTION_MARK.test(text),
        });
      }
    });
  }
  const headings = blocks.filter((b, i) => {
    const next = blocks[i + 1];
    return (
      (b.tag === 'h2' || b.tag === 'h3') &&
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
    words_after_h1: blocks.reduce((n, b) => n + b.words, 0),
    opening: openingWindow(blocks),
    headings: {
      count: headings.length,
      questions: blocks.filter((b) => (b.tag === 'h2' || b.tag === 'h3') && b.question).length,
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
