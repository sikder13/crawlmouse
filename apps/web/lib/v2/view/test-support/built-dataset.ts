/**
 * A built check as the screens read it, without a database: the dataset `loadCheckFor` answers for
 * the last of `builds` (checks of one site, oldest first), assembled from the engine's output by
 * `loadCheck`'s rules: the site's fixes as the last build left them, the events of both, the last
 * check's own pages, links, tests and changes, and the site's checks. real-data.test.ts holds this
 * against the PGlite round trip.
 */
import type { BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import { FixtureDatasetSchema, type Fix, type FixEvent, type Site } from '@crawlmouse/types/v2';
import { z } from 'zod';
import type { CheckDataset } from '../../pipeline/types';

const Schema = FixtureDatasetSchema.extend({ provenance: z.literal('measured') });
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function datasetOfBuilds(site: Site, builds: readonly BuiltCheck[]): CheckDataset {
  const last = builds.at(-1);
  if (!last) throw new Error('datasetOfBuilds: no build');
  const fixes = new Map<string, Fix>();
  const events = new Map<string, FixEvent>();
  for (const b of builds) {
    for (const f of b.fixes) fixes.set(f.id, f);
    for (const e of b.fix_events) events.set(e.id, e);
  }
  const numberOf = (fixId: string) => fixes.get(fixId)?.number ?? Infinity;
  const lineages = new Map(
    [last.lineages.grading, last.lineages.fetching].map((l) => [l.id, l] as const),
  );
  return Schema.parse({
    provenance: 'measured',
    as_of: last.check.finished_at,
    description: `${site.host}: check ${last.check.id}, built in memory.`,
    engine_derived: [],
    accounts: [],
    seats: [],
    sites: [site],
    checks: builds.map((b) => b.check),
    page_results: [...last.page_results].sort((a, b) => byText(a.url, b.url)),
    link_edges: [...last.link_edges].sort(
      (a, b) => byText(a.from_url, b.from_url) || byText(a.to_url, b.to_url),
    ),
    access_tests: [...last.access_tests].sort((a, b) => byText(a.id, b.id)),
    fixes: [...fixes.values()].sort((a, b) => a.number - b.number),
    fix_events: [...events.values()].sort(
      (a, b) =>
        numberOf(a.fix_id) - numberOf(b.fix_id) ||
        Date.parse(a.at) - Date.parse(b.at) ||
        byText(a.id, b.id),
    ),
    changes: last.changes,
    alert_rules: [],
    reports: [],
    lineages: [...lineages.values()],
    usage_events: last.usage_event ? [last.usage_event] : [],
    withheld: [],
  });
}
