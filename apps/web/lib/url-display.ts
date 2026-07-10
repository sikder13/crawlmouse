// SPEC 04.1 §6 / SPEC 04.2 FIX 3 / SPEC 04.3 — DISPLAY-ONLY decode of percent-encoded URLs for human-facing
// text on EVERY crawled-URL/anchor surface (activity feed, orphan/fix cards, action-packet chips + <pre>
// body, /r/ report ActionList, link-graph tooltip + node-detail, dashboard site URL). Crawlmouse is a GLOBAL
// tool, so this is language-agnostic (all of UTF-8). Wrap this ONLY around display strings — never a stored
// snapshot value, an `href`, a `?ref=` param, or the action-packet's machine/pasteable payload.
//
// SPEC 04.3 — TOLERANT. The old helper was all-or-nothing: `decodeURIComponent` THROWS on any string
// truncated mid-`%XX` — and the feed's label cap AND the engine's anchorText cap both produce exactly those —
// so the WHOLE string fell back RAW and leaked "%xx". Now: a fast path for well-formed input, else a
// WHATWG-style tolerant byte walk. A literal "%" not followed by two hex stays literal (protects "50% off");
// a truncated trailing escape or a dangling half-codepoint renders as a single "…". It NEVER throws, never
// leaves a raw %xx, and never ends in a bare U+FFFD.
export function safeDecodeUrlForDisplay(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return tolerantPercentDecode(raw);
  }
}

const HEX = /[0-9A-Fa-f]/;

// The tolerant path — only reached when `decodeURIComponent` threw (malformed or truncated input). Walks the
// string, accumulating maximal `%XX` byte runs and flushing them through a non-fatal UTF-8 decoder; a lone
// "%" in the middle stays literal, while an incomplete escape or half-codepoint at the very end collapses to
// a single "…". Never throws.
function tolerantPercentDecode(raw: string): string {
  let out = '';
  let bytes: number[] = [];
  let truncated = false;

  const flush = (): void => {
    if (bytes.length > 0) {
      // fatal:false → an incomplete/invalid sequence becomes U+FFFD; a TRAILING one is resolved to "…" below.
      out += new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
      bytes = [];
    }
  };

  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '%') {
      const a = raw[i + 1];
      const b = raw[i + 2];
      if (a !== undefined && b !== undefined && HEX.test(a) && HEX.test(b)) {
        bytes.push(parseInt(a + b, 16));
        i += 3;
        continue;
      }
      // "%" not followed by two hex. If the remainder is exactly "%" or "%<hex>" (an escape cut off at the
      // end), it's a truncated tail → "…". Otherwise it's a literal "%" (e.g. "50% off", "%zz").
      const rest = raw.slice(i);
      if (rest === '%' || (rest.length === 2 && HEX.test(rest[1]!))) {
        truncated = true;
        break;
      }
      flush();
      out += '%';
      i += 1;
    } else {
      flush();
      out += raw[i];
      i += 1;
    }
  }
  flush();

  // A dangling half-codepoint leaves a trailing U+FFFD; a cut-off escape set `truncated`. Either → one "…".
  if (truncated || out.endsWith('�')) {
    out = out.replace(/�+$/u, '') + '…';
  }
  return out;
}

// SPEC 04.2 FIX 3b — DISPLAY-ONLY decode of a multi-line action-packet body (the <pre> a human reads).
// Decodes each line INDEPENDENTLY via safeDecodeUrlForDisplay, so a prose line with a stray "%" (e.g. a
// "50% off" page title) throws and falls back on ITS line only, never blocking the URL lines. A prose line
// with a coincidentally-valid "%XX" (e.g. a title "Grade %41") decodes in the DISPLAY <pre> only — an
// accepted tradeoff (readable URLs ≫ protecting a pathological title substring); the clipboard payload is
// unaffected. NEVER wrap this around the clipboard/copy payload — that stays the raw, valid `packet.body`
// (actionPacketClipboardText).
export function decodeActionPacketBodyForDisplay(body: string): string {
  return body.split('\n').map(safeDecodeUrlForDisplay).join('\n');
}
