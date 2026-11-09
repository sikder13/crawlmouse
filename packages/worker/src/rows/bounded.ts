import {
  MAX_TEMPLATE_KEY_LENGTH,
  MAX_URL_LENGTH,
  ROBOTS_PARSE_LIMIT_BYTES,
  toPersistableText,
} from '@crawlmouse/engine/worker';
import {
  DECLARATION_MEDIA_TYPE_BYTES,
  JSON_LD_TYPE_BYTES,
  DESCRIPTION_BYTES,
  MAX_HREFLANG_CHARS,
  TITLE_BYTES,
} from '@crawlmouse/types/v2';
import { detached } from './detached.js';

/**
 * The one way the worker makes a string it stores: in a row, in a batch result, or in the robots.txt
 * cache. Each call names its cap from CAPS. stored-fields.test.ts runs batches built to overflow every
 * field, then walks what they store and checks that each string either came from here or is a fixed
 * format (an enum, an id, a timestamp).
 *
 * Two kinds of cap:
 * - text: cut to that many bytes of UTF-8 the way toPersistableText cuts (control characters
 *   dropped, a lone surrogate replaced), and held as a flat copy;
 * - whole: kept whole, as a copy, when it has at most that many characters, and otherwise not kept
 *   (null). URLs and robots.txt rules are whole: a cut URL or rule would be a different one.
 * - exact: as whole, and also not kept when toPersistableText would change it (a control character
 *   or a lone surrogate). For what a page declares, kept as written: a cleaned copy is not what it
 *   wrote.
 */

export interface TextCap {
  readonly kind: 'text';
  readonly bytes: number;
}
export interface WholeCap {
  readonly kind: 'whole' | 'exact';
  readonly chars: number;
}

const text = (bytes: number): TextCap => ({ kind: 'text', bytes });
const whole = (chars: number): WholeCap => ({ kind: 'whole', chars });
const exact = (chars: number): WholeCap => ({ kind: 'exact', chars });
/** UTF-8 bytes a string of `chars` UTF-16 units can take: at most three per unit. */
const MAX_BYTES_PER_CHAR = 3;

/**
 * The longest URL the worker reads, follows, links from or stores; the request schema holds URLs to
 * the same. The engine's (v2/batch-bounds.ts), which the check builder's planner reads too.
 */
export { MAX_URL_LENGTH };

export const CAPS = {
  url: whole(MAX_URL_LENGTH),
  /** As the request schema holds it (the engine's MAX_TEMPLATE_KEY_LENGTH). */
  templateKey: whole(MAX_TEMPLATE_KEY_LENGTH),
  /**
   * A site key (a registrable domain or an address) and an origin come from URLs within the URL cap, so
   * neither is cut in practice; they are text caps so that a row never loses one.
   */
  site: text(253),
  origin: text(MAX_URL_LENGTH),
  /** No rule is longer than the file it is in. */
  robotsRule: whole(ROBOTS_PARSE_LIMIT_BYTES),
  /** The contract's limits for these fields (packages/types/src/v2). */
  anchorText: text(2000),
  rawText: text(64 * 1024),
  bodyExcerpt: text(2000),
  headerName: text(128),
  headerValue: text(1024),
  identity: text(512),
  limitation: text(500),
  /** A registry token, which the contract holds as a short name. */
  token: text(64),
  /** What a robots.txt reading keeps of the file itself, as evidence. */
  robotsExcerpt: text(4096),
  /**
   * A robots.txt file kept whole for the check builder: within the engine's parse limit (a byte order
   * mark aside, a file read as rules is), and stored only as written.
   */
  robotsFile: exact(ROBOTS_PARSE_LIMIT_BYTES + 3),
  /** A JSON-LD type a page names, as written: a cut or cleaned type would be another type. */
  jsonLdType: exact(JSON_LD_TYPE_BYTES),
  /** A robots.txt request URL: an origin within the URL cap and `/robots.txt`. */
  robotsUrl: whole(MAX_URL_LENGTH + '/robots.txt'.length),
  /** A rel=canonical href, as written. */
  declaredHref: exact(MAX_URL_LENGTH),
  /** An hreflang value, as written; the contract's limit. */
  hreflang: exact(MAX_HREFLANG_CHARS),
  /** A page's title and meta description, collapsed (head-text.ts); the contract's limits. */
  title: text(TITLE_BYTES),
  description: text(DESCRIPTION_BYTES),
  /** A declaration file's Content-Type, as sent; the contract's limit. */
  mediaType: text(DECLARATION_MEDIA_TYPE_BYTES),
} as const;

export function bounded(value: string, cap: TextCap): string;
export function bounded(value: string, cap: WholeCap): string | null;
export function bounded(value: string, cap: TextCap | WholeCap): string | null {
  if (cap.kind === 'text') return detached(toPersistableText(value, cap.bytes));
  if (value.length > cap.chars) return null;
  if (cap.kind === 'exact' && toPersistableText(value, cap.chars * MAX_BYTES_PER_CHAR) !== value) {
    return null;
  }
  return detached(value);
}
