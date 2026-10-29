import { bounded, CAPS } from '../rows/bounded.js';
import { readLinks, type PageLinks } from '../rows/links.js';
import { countWords, readHtml, servedText } from '../rows/text.js';

/**
 * Reading a page: parsing its HTML and taking its text, word count and links. It costs CPU in
 * proportion to the page, and on the event loop four batches of large pages kept that loop busy for
 * the whole run, so a request's data waited behind other pages' parsing until its deadline passed.
 * The worker runs it on a thread of its own (thread-reader.ts), so the loop that times requests is
 * never the one parsing. Every function here is synchronous and pure; `inlineReader` runs them on
 * the calling thread, for tests.
 */

export interface PageRequest {
  body: string;
  bodyCut: boolean;
}

export interface WordCount {
  words: number | null;
  note: string | null;
}

export interface PageRead {
  /** What limits the read, when something does. */
  note: string | null;
  /** Null when the page was not read (nested too deep). */
  read: {
    links: PageLinks;
    /** The served text, as a crawl row stores it. */
    rawText: string;
    words: number;
  } | null;
}

/** The reader thread died during this read. The batch stops; see batch/crawl.ts and access.ts. */
export interface Crashed {
  crashed: true;
}

export interface PageReader {
  /** Words in an HTML response, for the access comparison. */
  words(body: string, bodyCut: boolean): Promise<WordCount | Crashed>;
  /** A crawl page: its links, text and word count. */
  page(body: string, bodyCut: boolean, finalUrl: string): Promise<PageRead | Crashed>;
}

export const isCrashed = (r: object): r is Crashed => 'crashed' in r;

export function readWords(req: PageRequest): WordCount {
  const { $, note } = readHtml(req);
  return { words: $ ? countWords(servedText($)) : null, note };
}

export function readPage(req: PageRequest & { finalUrl: string }): PageRead {
  const { $, note } = readHtml(req);
  if (!$) return { note, read: null };
  const links = readLinks($, req.finalUrl);
  const text = servedText($);
  return { note, read: { links, rawText: bounded(text, CAPS.rawText), words: countWords(text) } };
}

export const inlineReader: PageReader = {
  words: async (body, bodyCut) => readWords({ body, bodyCut }),
  page: async (body, bodyCut, finalUrl) => readPage({ body, bodyCut, finalUrl }),
};
