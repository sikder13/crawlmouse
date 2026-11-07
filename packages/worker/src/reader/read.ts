import {
  detectCms,
  readContentFeatures,
  simhashForDedup,
  type ContentFeatures,
} from '@crawlmouse/engine/worker';
import {
  CONTENT_FEATURES_BYTES,
  ContentFeaturesSchema,
  type ContentFeaturesRow,
} from '@crawlmouse/types/v2';
import { bounded, CAPS } from '../rows/bounded.js';
import { readLinks, type PageLinks } from '../rows/links.js';
import { countWords, readHtml, servedText } from '../rows/text.js';
import { headText, type HeadText } from '../rows/head-text.js';

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

/** A response's headers, lower-cased, as v1's detectCms reads them. */
export type StackHeaders = Record<string, string>;

export interface WordCount {
  words: number | null;
  note: string | null;
}

export interface PageRead {
  /** What limits the read, when something does. */
  note: string | null;
  /** Null when the page was not read (nested too deep). */
  read: {
    /**
     * The page's links and declarations. The main text stays on the reader, which hashes it, and the
     * canonical the extractor adopts is cut to the URL cap here: null when it was over it.
     */
    links: Omit<
      PageLinks,
      | 'mainTextStart'
      | 'canonicalUrl'
      | 'titleText'
      | 'descriptionText'
      | 'mainTextChars'
      | 'metaNoindex'
    > & {
      canonicalUrl: string | null | undefined;
    };
    /** The page's title and meta description, as a row stores them (rows/head-text.ts). */
    title: HeadText | null;
    description: HeadText | null;
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
    /**
     * The main content's length in characters (v1's `mainTextChars`, the classifier's thin-content
     * signal), and whether a robots, googlebot or bingbot meta tag says noindex or none. Null for a page
     * read only in part, whose main content and head were not all read.
     */
    mainTextChars: number | null;
    metaNoindex: boolean | null;
    /** What the content checks read (see `contentFeatures`); null with `featuresNote` saying why. */
    features: ContentFeaturesRow | null;
    featuresNote: string | null;
    /** The CMS the page's HTML and headers point to, when the caller asked (a batch's first URL). */
    stack: { cms: ReturnType<typeof detectCms>['cms'] } | null;
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
  page(
    body: string,
    bodyCut: boolean,
    finalUrl: string,
    stackHeaders?: StackHeaders | null,
  ): Promise<PageRead | NotRead>;
  /** Threads started after the first, each because the one before it died or was stopped. */
  readonly restarts?: number;
}

export const isNotRead = (r: object): r is NotRead => 'failed' in r;

export function readWords(req: PageRequest): WordCount {
  const { $, note } = readHtml(req);
  return { words: $ ? countWords(servedText($)) : null, note };
}

/**
 * The engine's content features (packages/engine/src/v2/content/read.ts), read from the same body the
 * words were counted on, for a page read whole: a page read in part would report markup past the cut
 * as absent. Kept when they fit the row's schema and CONTENT_FEATURES_BYTES serialised; past either,
 * the row keeps none and says so, because a check reading part of a page's JSON-LD could pass or fail
 * on what was left out.
 */
export function contentFeatures(body: string): {
  features: ContentFeaturesRow | null;
  note: string | null;
} {
  const read: ContentFeatures = readContentFeatures(body);
  // Each type the page names is stored as the helper copies it, or not at all.
  const json_ld = read.json_ld.map((n) => ({
    ...n,
    types: n.types.map((t) => bounded(t, CAPS.jsonLdType)),
  }));
  if (json_ld.some((n) => n.types.includes(null)))
    return { features: null, note: FEATURES_OVER_BOUNDS };
  const parsed = ContentFeaturesSchema.safeParse({ ...read, json_ld });
  if (!parsed.success) return { features: null, note: FEATURES_OVER_BOUNDS };
  if (Buffer.byteLength(JSON.stringify(parsed.data)) > CONTENT_FEATURES_BYTES) {
    return { features: null, note: FEATURES_OVER_BOUNDS };
  }
  return { features: parsed.data, note: null };
}

export const FEATURES_OVER_BOUNDS =
  "This page's content features were not kept: its JSON-LD is past the row's bounds, or names a type that cannot be stored as written, so the content checks treat it as not read.";

export function readPage(
  req: PageRequest & { finalUrl: string; stackHeaders?: StackHeaders | null },
): PageRead {
  const { $, note } = readHtml(req);
  if (!$) return { note, read: null };
  const {
    mainTextStart,
    canonicalUrl,
    titleText,
    descriptionText,
    mainTextChars,
    metaNoindex,
    ...rest
  } = readLinks($, req.finalUrl);
  const links = {
    ...rest,
    canonicalUrl: canonicalUrl === undefined ? undefined : bounded(canonicalUrl, CAPS.url),
  };
  const text = servedText($);
  const whole = note === null;
  const features = whole ? contentFeatures(req.body) : { features: null, note: null };
  return {
    note,
    read: {
      links,
      rawText: bounded(text, CAPS.rawText),
      words: countWords(text),
      simhash: note === null && mainTextStart ? simhashForDedup(mainTextStart) : null,
      title: headText(titleText, CAPS.title, note !== null),
      description: headText(descriptionText, CAPS.description, note !== null),
      mainTextChars: whole ? mainTextChars : null,
      metaNoindex: whole ? metaNoindex : null,
      features: features.features,
      featuresNote: features.note,
      stack: req.stackHeaders ? { cms: detectCms(req.body, req.stackHeaders).cms } : null,
    },
  };
}

export const inlineReader: PageReader = {
  words: async (body, bodyCut) => readWords({ body, bodyCut }),
  page: async (body, bodyCut, finalUrl, stackHeaders = null) =>
    readPage({ body, bodyCut, finalUrl, stackHeaders }),
};
