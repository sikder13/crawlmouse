// SPEC 04.1 §6 / SPEC 04.2 FIX 3 — DISPLAY-ONLY decode of percent-encoded URLs for human-facing text on
// EVERY crawled-URL surface: the result page (activity feed, orphan/fix cards, action-packet chips + <pre>
// body) AND the /r/ report (the prioritised-fix ActionList). Crawlmouse is a GLOBAL tool, so this must be
// language-agnostic — decodeURIComponent covers all of UTF-8 (Bengali, Arabic, CJK, Cyrillic, accented
// Latin, …). Wrap this ONLY around display strings — never a stored snapshot value, an `href`, a `?ref=`
// param, or the action-packet's machine/pasteable payload (those stay valid and unchanged). Malformed input
// (a truncated multibyte or a bare "%zz") throws inside decodeURIComponent — we fall back to the raw string
// so display never breaks.
export function safeDecodeUrlForDisplay(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
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
