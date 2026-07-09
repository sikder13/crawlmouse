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
