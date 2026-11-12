/**
 * Text from outside our code — a crawled hostname, URL or title, a packet, a member's note — enters a
 * template only through these (D3). `bounded` cuts it to a stated length first, with an ellipsis, so a
 * hostile page cannot make a message any size; `html` escapes the five characters that matter in HTML
 * text and attribute values. Neither makes a string safe as a link target: no template links to a string
 * it did not build.
 */

/** At most `max` characters (code points), ending with `…` when it was cut; control characters become spaces. */
export function bounded(value: string, max: number): string {
  const clean = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, ' ');
  const points = [...clean];
  return points.length <= max ? clean : `${points.slice(0, Math.max(0, max - 1)).join('')}…`;
}

/** One line for a subject or a list item: line breaks and tabs become single spaces, then bounded. */
export function oneLine(value: string, max: number): string {
  return bounded(
    value
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim(),
    max,
  );
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function html(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}
