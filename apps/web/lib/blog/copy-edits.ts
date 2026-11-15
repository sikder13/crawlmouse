// The sentences of existing posts changed for a reason other than D5's (lib/blog/v2-edits.ts), each
// as data in the same shape, so the existing-post guard (__tests__/blog-existing-posts-unchanged.test.tsx)
// reverses it as it reverses D5's. A sentence is here for one of two reasons:
//
//   banned-phrase     its wording is in lib/seo/banned-phrases.ts (D8); the after keeps the meaning
//                     in plainer words.
//   unsourced-figure  it states a figure about our own data that this repository cannot show; the
//                     after names no number.
//
// __tests__/blog-copy-edits.test.ts checks each against its reason and its file; the spec's D8 table
// is `copyEditsMarkdown()`. `updatedAt` does not move for these edits.
import type { V2Edit } from './v2-edits';

export interface CopyEdit extends V2Edit {
  slug: string;
  reason: 'banned-phrase' | 'unsourced-figure';
}

const content = (slug: string) => `lib/blog/content/${slug}.tsx`;
const CLOUDFLARE = 'cloudflare-ai-crawler-defaults-september-15';
const HOW_DEEP = 'how-deep-is-too-deep-crawl-depth';
const FREE_AUDIT = 'free-internal-link-audit';

export const COPY_EDITS: readonly CopyEdit[] = [
  {
    slug: CLOUDFLARE,
    file: content(CLOUDFLARE),
    line: 158,
    reason: 'unsourced-figure',
    source: {
      before:
        'This isn&rsquo;t a rare setup. Across the sites audited on Crawlmouse, roughly one in three\n        sits behind a detected edge or CDN layer whose rules can override whatever robots.txt\n        declares.',
      after:
        'This isn&rsquo;t a rare setup: many sites sit behind an edge or CDN layer whose rules can\n        override whatever robots.txt declares.',
    },
    html: {
      before:
        'This isn’t a rare setup. Across the sites audited on Crawlmouse, roughly one in three sits behind a detected edge or CDN layer whose rules can override whatever robots.txt declares.',
      after:
        'This isn’t a rare setup: many sites sit behind an edge or CDN layer whose rules can override whatever robots.txt declares.',
    },
    why: 'The repository holds no count behind it, and none can be made here without querying production: `audits.ai_readiness` records `accessMatrix.wafDetected` per audit, which counts recent audits (free audits expire after 30 days), not distinct sites. Owner: a measured number can replace "many".',
  },
  {
    slug: HOW_DEEP,
    file: content(HOW_DEEP),
    line: 145,
    reason: 'banned-phrase',
    source: {
      before: 'the cheapest, highest-leverage fix you have.',
      after: 'the cheapest, highest-impact fix you have.',
    },
    html: {
      before: 'the cheapest, highest-leverage fix you have.',
      after: 'the cheapest, highest-impact fix you have.',
    },
    why: 'Ruling 2 named this "leverage" for the plainest word that keeps the meaning.',
  },
  {
    slug: FREE_AUDIT,
    file: content(FREE_AUDIT),
    line: 107,
    reason: 'banned-phrase',
    source: {
      before: '<strong>Fix the cheap, high-leverage problems first.</strong>',
      after: '<strong>Fix the cheap, high-impact problems first.</strong>',
    },
    html: {
      before: '<strong>Fix the cheap, high-leverage problems first.</strong>',
      after: '<strong>Fix the cheap, high-impact problems first.</strong>',
    },
    why: 'Ruling 2 named this "leverage" for the plainest word that keeps the meaning.',
  },
];

/** The edits as a Markdown table, for the spec and PR.md (OPERATING-RULES §10: rendered from data). */
export function copyEditsMarkdown(edits: readonly CopyEdit[] = COPY_EDITS): string {
  const cell = (s: string) => s.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');
  const rows = edits.map(
    (e) =>
      `| \`apps/web/${e.file}:${e.line}\` | ${e.reason} | ${cell(e.html.before)} | ${cell(e.html.after)} | ${cell(e.why)} |`,
  );
  return [
    `${edits.length} sentences changed (D8 and the unsourced figure):`,
    '',
    '| Where | Reason | Before | After | Why |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}
