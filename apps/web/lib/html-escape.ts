/**
 * Escape a string for safe interpolation into raw HTML.
 *
 * The embed badge is served by a Route Handler that builds an HTML document as a
 * string (so it can be a standalone, layout-free document for the third-party
 * iframe). Unlike JSX, a raw template string does NOT auto-escape interpolated
 * values, so any value derived from a route param or the DB (e.g. the `domain`)
 * must be escaped before it lands in markup or an attribute. Escapes the five
 * HTML-significant characters; that covers both text-node and quoted-attribute
 * contexts.
 */
export function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
