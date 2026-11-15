import { COPY_EDITS } from '../../lib/blog/copy-edits';
import { V2_EDITS } from '../../lib/blog/v2-edits';

// What CC-40 adds to an existing post page, and how the two existing-post guards set it aside to
// compare what is left with the baseline (OPERATING-RULES §13). An addition is recognised by the
// container it renders in, never by a marker added for the test, so each selector below is a real
// element of the page:
//
//   p.post-summary             D4 (a): the direct answer under the H1 (components/blog/ArticleLayout.tsx)
//   section.post-questions     D4 (b): "Questions this answers" and its FAQPage JSON-LD
//   .post-author-role          D4 (e): the role and LinkedIn link the byline gains on an authored post
//   sup.post-source            D4 (d): an inline source for a number (lib/blog/post-source.tsx)
//   nav[aria-label="More on this topic"]   D6: the cluster links (components/blog/ClusterLinks.tsx, per the CC-40 plan)
//
// D4 (c) changes the existing date line rather than adding to it, so `dropUpdatedDate` removes the
// updated date from the baseline and the current page alike; the guards pin the current one to the
// post's `updatedAt` separately. Sentence edits are reversed from lib/blog/v2-edits.ts (D5) and
// lib/blog/copy-edits.ts (D8, and the unsourced figure).

export const ADDITION_SELECTORS = [
  'p.post-summary',
  'section.post-questions',
  '.post-author-role',
  'sup.post-source',
  'nav[aria-label="More on this topic"]',
] as const;

/** Removes every addition container under `root`. Returns how many it removed, per selector. */
export function stripAdditions(
  root: ParentNode,
): Record<(typeof ADDITION_SELECTORS)[number], number> {
  const removed = {} as Record<(typeof ADDITION_SELECTORS)[number], number>;
  for (const sel of ADDITION_SELECTORS) {
    const found = [...root.querySelectorAll(sel)];
    for (const el of found) el.remove();
    removed[sel] = found.length;
  }
  return removed;
}

/** Removes the updated date, and the separator before it, from the article header's date line. */
export function dropUpdatedDate(article: Element): void {
  const times = [...article.querySelectorAll('header time')];
  for (const t of times.slice(1)) {
    const sep = t.previousElementSibling;
    if (sep?.tagName === 'SPAN' && sep.textContent === '·') sep.remove();
    t.remove();
  }
}

/** The listed edits made in this post's body (the layout's D5 edit renders outside `<article>`). */
export const bodyEdits = (slug: string) =>
  [...V2_EDITS, ...COPY_EDITS].filter((e) => e.slug === slug);

/**
 * Puts each listed edit's baseline wording back. Throws if an edit's new wording is not in the
 * markup exactly once, so a listed edit that did not happen, or happened twice, fails the guard.
 */
export function reverseEdits(html: string, slug: string): string {
  let out = html;
  for (const e of bodyEdits(slug)) {
    const n = out.split(e.html.after).length - 1;
    if (n !== 1)
      throw new Error(`${slug}: the edit at ${e.file}:${e.line} renders ${n} times, not once`);
    out = out.replace(e.html.after, e.html.before);
  }
  return out;
}
