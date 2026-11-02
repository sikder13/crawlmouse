/**
 * Whether a page or a serialized view holds a line, in any form it could carry it in: as written,
 * HTML-escaped as React escapes text, JSON-escaped as flight data and JSON.stringify write it, or
 * by its longest run of plain characters, which reads the same however it is escaped. A search
 * for the raw line alone misses a line holding a quote, since both encodings change the quote.
 */
export const holds = (body: string, line: string) => {
  const html = line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
  const plain = (line.match(/[A-Za-z0-9 ,.;:()-]{24,}/g) ?? []).sort(
    (a, b) => b.length - a.length,
  )[0];
  return [line, html, JSON.stringify(line).slice(1, -1), plain]
    .filter((f): f is string => Boolean(f))
    .some((f) => body.includes(f));
};
