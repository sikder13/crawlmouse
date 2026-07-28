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

/**
 * Replace every unpaired surrogate with U+FFFD, leaving valid pairs intact. Equivalent to
 * `String.prototype.toWellFormed()` (pinned by test), but implemented here so the engine carries no
 * silent dependency on the runtime's ECMAScript version.
 *
 * Length-preserving (U+FFFD is a single code unit), so it never shifts a subsequent cut offset — and
 * it returns the SAME REFERENCE when the input is already well-formed, which is the overwhelmingly
 * common case and the reason this is byte-identity-safe for existing fixtures.
 */
export function wellFormText(s: string): string {
  if (!hasLoneSurrogate(s)) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= HIGH_MIN && c <= HIGH_MAX) {
      const next = s.charCodeAt(i + 1);
      if (next >= LOW_MIN && next <= LOW_MAX) {
        out += s[i]! + s[i + 1]!;
        i++;
      } else {
        out += REPLACEMENT;
      }
    } else if (c >= LOW_MIN && c <= LOW_MAX) {
      out += REPLACEMENT;
    } else {
      out += s[i]!;
    }
  }
  return out;
}

/**
 * Cut to at most `cap` code units WITHOUT splitting a surrogate pair.
 *
 * When the last kept unit is a high surrogate, its low half is the first unit dropped, so the cut is
 * pulled back by one. Assumes well-formed input (compose via `toPersistableText`); on malformed input
 * it still never *creates* a new lone surrogate, it simply cannot repair a pre-existing one.
 */
/** UTF-8 width of a code point. */
function utf8Width(cp: number): number {
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/**
 * Cut to at most `maxBytes` UTF-8 BYTES, stepping whole code points.
 *
 * THE UNIT IS THE POINT. Every cap here used to count UTF-16 code units while PostgREST sends UTF-8,
 * so the real wire size was up to 3x the number asserted: a plain Chinese-language page measured
 * 12 947 bytes per `ai_signals` row against a "4.5 KB" budget, and a 2000-page audit produced a single
 * 29.67 MB insert body. A bound measured in a different unit than the database is not a bound.
 *
 * ASCII is unaffected — one char is one byte — so every existing fixture and the minted-snapshot
 * byte-identity pin are unchanged. Non-Latin text yields fewer CHARACTERS for the same budget, which
 * is intended: the budget exists to bound what crosses the wire.
 *
 * Stepping by code point means a surrogate pair is never split, and a multi-byte UTF-8 sequence is
 * never cut mid-sequence.
 */
export function truncateToBytes(s: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  let bytes = 0;
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i)!;
    const width = utf8Width(cp);
    if (bytes + width > maxBytes) break;
    bytes += width;
    i += cp > 0xffff ? 2 : 1; // a surrogate pair advances two code units
  }
  return i === s.length ? s : s.slice(0, i);
}

export function truncateWithoutSplitting(s: string, cap: number): string {
  if (cap <= 0) return '';
  if (s.length <= cap) return s;
  const last = s.charCodeAt(cap - 1);
  return s.slice(0, last >= HIGH_MIN && last <= HIGH_MAX ? cap - 1 : cap);
}

/**
 * The one call every crawled string bound for a database column, a public artifact, or an exported
 * file must go through: repair inbound damage, then cut without causing new damage. Order matters —
 * repairing first means the cut always sees well-formed input, so the two hazards cannot interact.
 *
 * `maxBytes` is a UTF-8 BYTE budget, matching what PostgREST actually sends. ASCII behaviour is
 * identical to the previous code-unit budget.
 */
export function toPersistableText(s: string, maxBytes: number): string {
  return truncateToBytes(wellFormText(s), maxBytes);
}
