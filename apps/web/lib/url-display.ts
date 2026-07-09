// SPEC 04.1 §6 — DISPLAY-ONLY decode of percent-encoded URLs for human-facing text on the result
// surface (the /r/ report already decodes). Wrap this ONLY around display strings — never around a
// stored snapshot value, an `href`, a `?ref=` param, or the action-packet's machine/pasteable payload
// (those stay valid and unchanged). Malformed input (e.g. a truncated multibyte or a bare "%zz")
// throws inside decodeURIComponent — we fall back to the raw string so display never breaks.
export function safeDecodeUrlForDisplay(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// SPEC 04.2 FIX 3b — DISPLAY-ONLY decode of a multi-line action-packet body (the <pre> a human reads).
// Decodes each line INDEPENDENTLY via safeDecodeUrlForDisplay, so a prose line with a stray "%" (e.g. a
// "50% off" page title) throws and falls back on ITS line only, never blocking the URL lines. NEVER wrap
// this around the clipboard/copy payload — that stays the raw, valid `packet.body` (actionPacketClipboardText).
export function decodeActionPacketBodyForDisplay(body: string): string {
  return body.split('\n').map(safeDecodeUrlForDisplay).join('\n');
}
