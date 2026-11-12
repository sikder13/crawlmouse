/** PacketFacts for tests that grade a GradeInput directly, without the check builder. */
import type { CrawlerAccess } from '../../access/types.js';
import type { GradeInput } from '../../grade/index.js';
import type { PacketFacts } from '../types.js';

export const NO_STACK: PacketFacts['stack'] = { frontend: null, backend: null, edge: null };

export function factsFor(
  input: Pick<GradeInput, 'pages' | 'edges' | 'homepage_url'>,
  crawlers: readonly Pick<CrawlerAccess, 'ua' | 'verdict'>[] = [],
  stack: PacketFacts['stack'] = NO_STACK,
): PacketFacts {
  return {
    homepage_url: input.homepage_url,
    stack,
    crawlers,
    pages: new Map(input.pages.map((p) => [p.url, p])),
    edges: input.edges,
    access_tests: [],
  };
}
