// The data behind a research post, for its Dataset JSON-LD (lib/seo/jsonld.tsx `datasetLd`). Each
// field is drawn from the post's own body and lists the body text it comes from;
// __tests__/blog-answers.test.tsx checks that text occurs in the rendered body and that the dates
// and the sample size say what that text says.

import type { Drawn } from './answers';

export interface PostDataset {
  name: string;
  description: Drawn;
  /** First and last collection day, ISO dates, each as the body writes it in `from`. */
  collected: { start: string; end: string; from: readonly [string, string] };
  /** The sample size, as schema.org `size` text. */
  size: Drawn;
}

export const DATASETS: Readonly<Record<string, PostDataset>> = {
  'ai-crawler-access-test-2026': {
    name: 'AI crawler access tests, October 2026',
    description: {
      text: 'Three rounds of live tests that fetched real websites with the published user-agent strings of AI crawlers and compared the answer with a plain browser fetch of the same page. These are simulated requests from cloud networks, not the crawlers themselves.',
      from: [
        'In October we ran three rounds of live tests. Each fetched real websites with the published user-agent strings of AI crawlers, such as GPTBot, ClaudeBot and PerplexityBot, and compared the answer with a plain browser fetch of the same page.',
        'So the results below are simulated requests: they show how a site treated our infrastructure, and they are labelled as simulated.',
        'Our requests carried crawler names; they did not come from the crawlers.',
        'from two cloud networks',
      ],
    },
    collected: {
      start: '2026-10-25',
      end: '2026-10-27',
      from: ['25 October 2026', '27 October 2026'],
    },
    size: {
      text: '96 websites',
      from: ['Across the rounds we fetched 96 distinct websites.'],
    },
  },
};

/** The post's dataset, or null. Own keys only. */
export function getDataset(slug: string): PostDataset | null {
  return Object.hasOwn(DATASETS, slug) ? DATASETS[slug]! : null;
}
