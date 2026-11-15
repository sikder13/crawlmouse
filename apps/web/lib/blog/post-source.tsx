// D4 (d): inline sources added to posts for numbers they stated without one. Each is listed here
// with what it sources and when the source was read, rendered in the body as `<PostSource>`, and
// checked by __tests__/blog-answer-layout.test.tsx (the rendered links equal this list). The
// existing-post guard sets `sup.post-source` aside as an addition.

export interface PostSourceEntry {
  slug: string;
  url: string;
  label: string;
  /** The numbers in the post's sentence that this source states. */
  states: string;
  /** When the source was read and found to state them. */
  checked: string;
}

export const POST_SOURCES = {
  'vercel-merj-ai-crawlers': {
    slug: 'can-ai-crawlers-see-javascript',
    url: 'https://vercel.com/blog/the-rise-of-the-ai-crawler',
    label: 'Vercel and MERJ, December 2024',
    states: 'JavaScript files fetched on 11.50% of ChatGPT requests and 23.84% of Claude requests',
    checked: '2026-11-15',
  },
} as const satisfies Record<string, PostSourceEntry>;

export type PostSourceKey = keyof typeof POST_SOURCES;

/** A footnote-style link to a listed source. */
export function PostSource({ k }: { k: PostSourceKey }) {
  const s = POST_SOURCES[k];
  return (
    <sup className="post-source">
      [<a href={s.url}>{s.label}</a>]
    </sup>
  );
}
