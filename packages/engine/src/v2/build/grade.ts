/**
 * The engine's verdicts on the assembled check, in the one order each needs the last:
 *
 *   detectAccess → detectStructure → (orphans and their parents onto the pages) → gradeCheck →
 *   detectorOutcomes (which computes the fix effects, effectsOf, itself)
 *
 * Each is called once, on the same pages and the same links: the detectors read the links as recorded
 * and file a redirected page's under it themselves (detectors/scope.ts); the grade reads them filed by
 * the same rule (filing.ts). build.calls.test.ts counts the calls and holds the grade's links to
 * filing.ts over the detectors' input; filing.test.ts holds filing.ts to the detectors' own filing. The withheld reasons, refusals and
 * fix effects are theirs, passed through.
 */
import type { PageResult } from '@crawlmouse/types/v2';
import { buildCorpus } from '../../projection/relevance.js';
import { enumerateFixes } from '../../projection/ledger.js';
import { detectAccess } from '../access/index.js';
import type { AccessResult } from '../access/types.js';
import { subjectOfKey } from '../detectors/fingerprint.js';
import { detectRendered } from '../detectors/rendered.js';
import { detectStructure } from '../detectors/index.js';
import type { Detection } from '../detectors/types.js';
import type { DetectorOutcome } from '../diff/types.js';
import { gradeCheck, type Grades } from '../grade/index.js';
import { detectorOutcomes } from '../grade/outcomes.js';
import type { PacketFacts } from '../packets/types.js';
import { writtenFrom } from '../packets/written.js';
import type { Assembled } from './assemble.js';
import { stackOf } from './record.js';
import type { BuildInput } from './types.js';

export interface Graded {
  /** The pages with `is_orphan`, `suggested_parent_url` and `content_failures` set. */
  pages: PageResult[];
  robots_txt: string | null;
  access: AccessResult;
  structure: Detection[];
  grades: Grades;
  outcomes: DetectorOutcome[];
}

export function gradeAssembled(
  input: Pick<BuildInput, 'check' | 'previous'>,
  assembled: Assembled,
  robots_txt: string | null,
): Graded {
  const access = detectAccess({ access_tests: assembled.access_tests, pages: assembled.pages });
  const structure = detectStructure({
    // The detectors read `partial` as "the crawl was cut short" (status.ts).
    check: {
      status: assembled.status.crawl_partial ? 'partial' : 'finished',
      coverage: assembled.coverage,
    },
    page_cap: input.check.page_cap,
    homepage_url: assembled.homepage_url,
    pages: assembled.pages,
    edges: assembled.edges,
    disallowed: assembled.disallowed,
    previous_coverage: input.previous?.check.coverage ?? null,
    client_rendered: assembled.client_rendered,
  });
  const orphans = new Set(
    structure
      .filter((d) => d.type === 'orphan_pages' && d.state === 'detected')
      .map((d) => subjectOfKey(d.key)),
  );
  const parents = suggestedParents(assembled, orphans);
  const withOrphans = assembled.pages.map((p) => ({
    ...p,
    is_orphan: orphans.has(p.url),
    suggested_parent_url: parents.get(p.url) ?? null,
  }));
  const grades = gradeCheck({
    pages: withOrphans,
    // Filed under the page they were found on, as the detectors file them for themselves (filing.ts).
    edges: assembled.filed_edges,
    homepage_url: assembled.homepage_url,
    content: assembled.content,
    crawlers: access.crawlers,
    structure,
    robots_txt,
    refusal: assembled.refusal,
  });
  // What a fix's packet is written from besides its own record (packets/types.ts).
  const facts: PacketFacts = {
    homepage_url: assembled.homepage_url,
    stack: stackOf(assembled),
    crawlers: access.crawlers,
    pages: new Map(withOrphans.map((p) => [p.url, p])),
    edges: assembled.edges,
    access_tests: assembled.access_tests,
  };
  const { outcomes } = detectorOutcomes(
    grades,
    access.detections,
    structure,
    detectRendered(withOrphans),
    writtenFrom(facts),
  );
  const pages = withOrphans.map((p) => ({
    ...p,
    content_failures: grades.content_failures.get(p.url) ?? null,
  }));
  return { pages, robots_txt, access, structure, grades, outcomes };
}

/**
 * v1's prescription for an orphan (projection/ledger.ts enumerateFixes, `orphan`): the most relevant
 * page by TF-IDF over titles, anchors and URL slugs that does not already link to it. v1 walks its own
 * orphan set (the graph's pages with no inbound link, in the graded population); an orphan CC-16
 * detected that v1 has no prescription for keeps a null parent.
 */
function suggestedParents(assembled: Assembled, orphans: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  if (orphans.size === 0) return out;
  const graded = new Set(assembled.pages.filter((p) => p.kind === 'content').map((p) => p.url));
  const fixes = enumerateFixes(assembled.graph, assembled.analysis, {
    homepageUrl: assembled.homepage_url,
    isExcluded: (u) => !graded.has(u),
    corpus: buildCorpus(assembled.graph),
    linksPerFix: 1,
  });
  for (const f of fixes) {
    const from = f.suggestedLinks[0]?.fromUrl;
    if (f.category === 'orphan' && orphans.has(f.targetUrl) && from !== undefined)
      out.set(f.targetUrl, from);
  }
  return out;
}
