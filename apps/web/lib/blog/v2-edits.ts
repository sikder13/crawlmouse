// D5: the sentences in the blog that promised v1 behaviour (an A–F internal-link grade, a 0–100
// AI-readiness score, Pro's v1 contents), each changed to a wording true with the v2 flags off and
// on. Nothing else in a post's body changes. This list is the record: the spec's table is rendered
// from it (`v2EditsMarkdown`), __tests__/blog-v2-edits.test.ts checks each `after` stands in its
// file at `line` and each `before` is gone, and the existing-post guard
// (__tests__/blog-existing-posts-unchanged.test.tsx) reverses each `html` edit and requires the
// baseline markup back, byte for byte, so an edit not listed here fails it.

export interface V2Edit {
  /** The post the edit is in; null for the article layout every post renders. */
  slug: string | null;
  /** Path from apps/web. */
  file: string;
  /** Line of `file` on which `source.after` starts. */
  line: number;
  /** The source text, before and after. */
  source: { before: string; after: string };
  /** The same edit in the rendered markup, as the guard's baseline serialises it. */
  html: { before: string; after: string };
  /** What the old wording promised that one build does not do. */
  why: string;
}

export const V2_EDITS: readonly V2Edit[] = [];

/** The edits as a Markdown table, for the spec and PR.md (OPERATING-RULES §10: rendered from data). */
export function v2EditsMarkdown(edits: readonly V2Edit[] = V2_EDITS): string {
  const cell = (s: string) => s.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');
  const rows = edits.map(
    (e) =>
      `| \`apps/web/${e.file}:${e.line}\` | ${cell(e.html.before)} | ${cell(e.html.after)} | ${cell(e.why)} |`,
  );
  return [
    `${edits.length} sentences changed (D5):`,
    '',
    '| Where | Before | After | Why |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}
