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

const LAYOUT = 'components/blog/ArticleLayout.tsx';
const content = (slug: string) => `lib/blog/content/${slug}.tsx`;

export const V2_EDITS: readonly V2Edit[] = [
  {
    slug: null,
    file: LAYOUT,
    line: 112,
    source: {
      before:
        'Crawlmouse crawls your site, maps every internal link, and gives you an A–F grade in\n            under two minutes. Free, no install.',
      after:
        'Crawlmouse crawls your site, maps every internal link, and grades what it finds. Free,\n            no install.',
    },
    html: {
      before:
        'Crawlmouse crawls your site, maps every internal link, and gives you an A–F grade in under two minutes. Free, no install.',
      after:
        'Crawlmouse crawls your site, maps every internal link, and grades what it finds. Free, no install.',
    },
    why: 'An A–F internal-linking grade is v1’s result; v2 grades AI readability and Technical SEO, and gives its time as about two minutes.',
  },
  {
    slug: 'screaming-frog-alternative',
    file: content('screaming-frog-alternative'),
    line: 89,
    source: {
      before:
        "get an A&ndash;F internal-linking grade and a 0&ndash;100{' '}\n        <Link href={'/ai-readiness-checker' as Route}>AI-readiness score</Link> for the whole site,\n        with fixes",
      after:
        "get grades for the whole site&rsquo;s structure and for{' '}\n        <Link href={'/ai-readiness-checker' as Route}>how well AI crawlers can read it</Link>, with\n        fixes",
    },
    html: {
      before:
        'get an A–F internal-linking grade and a 0–100 <a href="/ai-readiness-checker">AI-readiness score</a> for the whole site, with fixes',
      after:
        'get grades for the whole site’s structure and for <a href="/ai-readiness-checker">how well AI crawlers can read it</a>, with fixes',
    },
    why: 'The A–F internal-linking grade and the 0–100 AI-readiness score are v1’s; v2 grades AI readability and Technical SEO.',
  },
  {
    slug: 'screaming-frog-alternative',
    file: content('screaming-frog-alternative'),
    line: 109,
    source: {
      before:
        '<strong>Price:</strong> free; Pro at $19/month for every fix, CSV export, and white-label\n        reports.',
      after: '<strong>Price:</strong> free; paid plans from $19/month.',
    },
    html: {
      before:
        '<strong>Price:</strong> free; Pro at $19/month for every fix, CSV export, and white-label reports.',
      after: '<strong>Price:</strong> free; paid plans from $19/month.',
    },
    why: 'In v2, white-label reports are on Agency, not Pro; Pro is still $19 a month in both builds.',
  },
  {
    slug: 'free-internal-link-audit',
    file: content('free-internal-link-audit'),
    line: 98,
    source: {
      before: 'and returns a single A&ndash;F grade plus the specific problems',
      after: 'and returns a grade for its structure plus the specific problems',
    },
    html: {
      before: 'and returns a single A–F grade plus the specific problems',
      after: 'and returns a grade for its structure plus the specific problems',
    },
    why: 'A single A–F internal-linking grade is v1’s result; v2 returns two grades.',
  },
  {
    slug: 'sitebulb-alternative',
    file: content('sitebulb-alternative'),
    line: 161,
    source: {
      before: 'returns a single A&ndash;F grade plus the specific problems behind it',
      after: 'returns a grade for its structure plus the specific problems behind it',
    },
    html: {
      before: 'returns a single A–F grade plus the specific problems behind it',
      after: 'returns a grade for its structure plus the specific problems behind it',
    },
    why: 'A single A–F internal-linking grade is v1’s result; v2 returns two grades.',
  },
];

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
