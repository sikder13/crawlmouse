/**
 * Text as one cell of a Markdown table: line breaks, and the whitespace around them, become one
 * space; a backslash is escaped before a pipe is, so text ending in `\` cannot turn the pipe's escape
 * into a literal backslash and end the cell early. Shared by the docs tables CC-40 renders from data.
 */
export function markdownCell(text: string): string {
  return text
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|');
}
