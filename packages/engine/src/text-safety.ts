/**
 * THE single place crawled text is made safe to persist. Nothing else may cut a crawled string.
 *
 * WHY THIS EXISTS
 * Crawled text is attacker-controlled (anyone can submit a URL they control) and is written into
 * Postgres `jsonb`/`text` columns through PostgREST, whose request body is parsed as JSON *by
 * Postgres*. Postgres REJECTS an unpaired UTF-16 surrogate (22P02, "Unicode low surrogate must
 * follow a high surrogate"). One such character anywhere in an insert body fails the insert, which
 * throws in `persistAuditResults` and fails THE WHOLE AUDIT — not just that page.
 *
 * TWO DISTINCT HAZARDS, which is why this is two operations and not one:
 *
 *   1. SPLITTING — a char-index cut (`.slice(0, n)`) lands between the halves of a valid pair and
 *      manufactures a lone surrogate out of well-formed input. Every cutter on crawled text has
 *      this bug by default.
 *   2. INBOUND — the string arrives already malformed, with no cut involved. `JSON.parse` ACCEPTS
 *      an unpaired `\uXXXX` escape (`JSON.parse('{"@type":"\\ud800"}')` yields a lone surrogate),
 *      so crawled JSON-LD can carry one whole. **Surrogate-safe truncation alone does not fix
 *      this** — the value must be well-formed independently of any cut.
 *
 * The producer set is CLOSED and was verified empirically, not assumed: HTML text extraction cannot
 * produce a lone surrogate (cheerio/htmlparser2 maps surrogate-range numeric character references to
 * U+FFFD per the HTML spec), `decodeURIComponent` throws on surrogate byte sequences, and
 * TextDecoder/Buffer decoding yields U+FFFD. So the only producers are (1) truncation and (2) the one
 * `JSON.parse` of crawled JSON — both handled here.
 *
 * DETERMINISM (R1): pure, allocation-free on the common path, no locale/ICU/Intl dependence. Same
 * input always yields byte-identical output, and both operations are the identity on input that is
 * already well-formed and already within cap — which is what keeps every pre-existing fixture and the
 * minted-snapshot byte-identity pin unchanged.
 */

const HIGH_MIN = 0xd800;
const HIGH_MAX = 0xdbff;
const LOW_MIN = 0xdc00;
const LOW_MAX = 0xdfff;
/** What an unpaired half is replaced with — the same substitution `String.prototype.toWellFormed` makes. */
const REPLACEMENT = '�';

/** True when `s` contains a surrogate code unit that is not part of a valid pair. */
export function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= HIGH_MIN && c <= HIGH_MAX) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= LOW_MIN && next <= LOW_MAX)) return true;
      i++; // valid pair — skip its low half
    } else if (c >= LOW_MIN && c <= LOW_MAX) {
      return true; // a low half with no high half before it
    }
  }
  return false;
}

/** UTF-8 width of a code point. */
function utf8Width(cp: number): number {
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/**
 * C0 controls that are stripped. `\t`, `\n` and `\r` are kept — they are legitimate whitespace in
 * crawled prose and cost 2 JSON bytes, not 6.
 *
 * NUL is a CORRECTNESS requirement, verified against a real Postgres (PGlite) rather than reasoned
 * about: it is rejected by `jsonb` as 22P05 *and* by `text` as "invalid byte sequence for encoding
 * UTF8: 0x00". The rest are a SIZE requirement — `JSON.stringify` renders U+0001 as the six-byte
 * `\u0001`, so a 2000-byte budget of them put 12 000 bytes on the wire and blew every documented
 * ceiling by ~5x.
 */
function isStrippedControl(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false;
  return code < 0x20 || code === 0x7f;
}

/**
 * THE one call every crawled string bound for a database column, a public artifact or an exported file
 * must go through. A SINGLE bounded pass that does all three jobs at once:
 *
 *   1. repairs unpaired surrogates (rejected by `jsonb`; accepted by `text`),
 *   2. strips C0 controls including NUL (NUL rejected by BOTH; the rest cost 6 wire bytes each),
 *   3. truncates to a UTF-8 BYTE budget, stepping whole code points.
 *
 * FUSED, not composed, and that is load-bearing. The previous repair-then-cut version scanned and
 * copied the ENTIRE input before cutting to 100 bytes: one lone surrogate inside a 5 MB `@type` cost
 * 304 ms, and 25 of them cost 6.3 s on a single page. This version stops the moment the budget is
 * full, so the work is O(min(input, budget)) and the pathological input costs nothing extra.
 *
 * The composition-order question the old two-step version had to pin no longer exists: there is one
 * pass, and a lone surrogate is charged the 3 bytes of the U+FFFD it becomes, so no ordering can
 * disagree with any other.
 *
 * ASCII is unchanged — one char, one byte — which is what keeps every existing fixture and the
 * minted-snapshot byte-identity pin intact. Non-Latin text yields fewer CHARACTERS for the same
 * budget: intended, because the budget exists to bound what crosses the wire, and the wire is bytes.
 */
export function toPersistableText(s: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  let out = '';
  let bytes = 0;
  let i = 0;
  while (i < s.length) {
    const code = s.charCodeAt(i);
    let piece: string;
    let step: number;

    if (code >= HIGH_MIN && code <= HIGH_MAX) {
      const next = s.charCodeAt(i + 1);
      if (next >= LOW_MIN && next <= LOW_MAX) {
        piece = s.slice(i, i + 2); // a valid pair, kept whole
        step = 2;
      } else {
        piece = REPLACEMENT; // unpaired high half
        step = 1;
      }
    } else if (code >= LOW_MIN && code <= LOW_MAX) {
      piece = REPLACEMENT; // unpaired low half
      step = 1;
    } else if (isStrippedControl(code)) {
      i += 1;
      continue;
    } else {
      piece = s[i]!;
      step = 1;
    }

    const width = utf8Width(piece.codePointAt(0)!);
    if (bytes + width > maxBytes) break;
    out += piece;
    bytes += width;
    i += step;
  }
  return out;
}
