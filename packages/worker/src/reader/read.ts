import { simhashForDedup } from '@crawlmouse/engine/worker';
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
    /** The page's links and declarations; the main text stays on the reader, which hashes it. */
    links: Omit<PageLinks, 'mainTextStart'>;
    /** The served text, as a crawl row stores it. */
    rawText: string;
    words: number;
    /**
     * simhashForDedup (the engine's v1 hash) over the first HASHED_TEXT_CHARS characters of the
     * page's main content (extractMainContent's text, read in the links walk). That is the hash of the
     * whole main content when those characters hold SIMHASH_MAX_TOKENS tokens, and a hash of the
     * prefix when they do not. Null under SIMHASH_MIN_TOKENS tokens, and for a page read only in part
     * (a `note`), whose main content was not all read.
     */
    simhash: string | null;
  } | null;
}

/**
 * Why the reader gave no answer for a page: the thread died while reading it, or the read passed its
 * deadline and the thread was stopped. Only that read fails; the reads queued behind it go to a new
 * thread. Neither says anything about the site. See thread-reader.ts.
 */
export type ReaderFailure = 'reader_thread_crashed' | 'reader_deadline';

export interface NotRead {
  failed: ReaderFailure;
}

/** A read that throws rejects, on the thread as inline, and is not a NotRead. */
export interface PageReader {
  /** Words in an HTML response, for the access comparison. */
  words(body: string, bodyCut: boolean): Promise<WordCount | NotRead>;
  /** A crawl page: its links, text and word count. */
  page(body: string, bodyCut: boolean, finalUrl: string): Promise<PageRead | NotRead>;
  /** Threads started after the first, each because the one before it died or was stopped. */
  readonly restarts?: number;
}

export const isNotRead = (r: object): r is NotRead => 'failed' in r;

export function readWords(req: PageRequest): WordCount {
  const { $, note } = readHtml(req);
  return { words: $ ? countWords(servedText($)) : null, note };
}

export function readPage(req: PageRequest & { finalUrl: string }): PageRead {
  const { $, note } = readHtml(req);
  if (!$) return { note, read: null };
  const { mainTextStart, ...links } = readLinks($, req.finalUrl);
  const text = servedText($);
  return {
    note,
    read: {
      links,
      rawText: bounded(text, CAPS.rawText),
      words: countWords(text),
      simhash: note === null && mainTextStart ? simhashForDedup(mainTextStart) : null,
    },
  };
}

export const inlineReader: PageReader = {
  words: async (body, bodyCut) => readWords({ body, bodyCut }),
  page: async (body, bodyCut, finalUrl) => readPage({ body, bodyCut, finalUrl }),
};
