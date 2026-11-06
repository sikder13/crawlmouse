/**
 * buildCheck: from what the worker returned and what the database holds to the rows a finished check
 * writes (CC-20a). Pure and synchronous: no network, clock, randomness or environment, so CC-20b can
 * run it again on a retry and get the same rows.
 *
 * Order: read the batches → assemble pages and links → check the access tests and renders against the
 * planners → detect and grade (grade.ts) → the Check record → diff → lineage and usage → validate.
 *
 * Every row is parsed with its contract schema before it is returned (SPEC 06 Follow-ups: the writer
 * validates; the database does not hold these rules). A row that does not parse throws, naming the
 * collection, the row and the path.
 */
import {
  AccessTestSchema,
  ChangeSchema,
  CheckSchema,
  FixEventSchema,
  FixSchema,
  LinkEdgeSchema,
  MeasurementLineageSchema,
  PageResultSchema,
  UsageEventSchema,
} from '@crawlmouse/types/v2';
import { GRADE_VERSION } from '../grade/weights.js';
import { assemble } from './assemble.js';
import { readBatches } from './batches.js';
import { diffBuilt, diffInputsOf } from './diff.js';
import { gradeAssembled } from './grade.js';
import { lineagesOf, usageOf } from './lineage.js';
import { sample } from './plan.js';
import { checkRecord, robotsText } from './record.js';
import { summariesOf } from './summaries.js';
import type { BuildInput, BuiltCheck } from './types.js';

/** What `valid` needs of a contract schema. */
interface Schema<T> {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: readonly { path: PropertyKey[]; message: string }[] } };
}

function valid<T>(schema: Schema<T>, collection: string, rows: readonly unknown[]): T[] {
  return rows.map((row, i) => {
    const parsed = schema.safeParse(row);
    if (parsed.success) return parsed.data;
    const issue = parsed.error.issues[0]!;
    throw new Error(
      `buildCheck: ${collection}[${i}] is not a valid row: ${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
    );
  });
}

export function buildCheck(input: BuildInput): BuiltCheck {
  if (input.check.grade_version !== GRADE_VERSION) {
    throw new Error(
      `buildCheck: the check asks for grade ${input.check.grade_version}; this engine grades ${GRADE_VERSION}`,
    );
  }
  const batches = readBatches(input.batches, input.check, input.lineage.worker_release);
  const assembled = assemble(input, batches);

  // An access test or a render the planners would not have asked for is refused: the rows would
  // claim a sample the check did not choose.
  const planned = sample(assembled);
  const sampled = new Set([...planned.stage1, ...planned.stage2].map((p) => p.url));
  for (const t of assembled.access_tests) {
    if (!sampled.has(t.page_url)) {
      throw new Error(
        `buildCheck: an access test of ${t.page_url}, which the sample does not hold`,
      );
    }
  }
  // renderCandidates offers the sampled pages and nothing else.
  for (const p of input.render?.pages ?? []) {
    if (!sampled.has(p.url))
      throw new Error(`buildCheck: a render of ${p.url}, which the sample does not hold`);
  }

  const robots = robotsText(batches.crawl, assembled.homepage_url);
  const graded = gradeAssembled(input, assembled, robots);
  const check = checkRecord(input, batches.crawl, batches.access, assembled, graded);
  const diff_inputs = diffInputsOf(input.check.page_cap, robots, graded.outcomes);
  const diff = diffBuilt(input, { check, ...diff_inputs }, graded.outcomes);
  const lineages = lineagesOf(input);
  const all = [...batches.crawl, ...batches.access];
  const usage = usageOf(input.site.account_id, check, all, input.render);
  const rendered = input.render
    ? {
        rendered: input.render.pages.filter((p) => p.rendered).length,
        not_rendered: input.render.pages.filter((p) => !p.rendered).length,
      }
    : null;

  return {
    check: valid(CheckSchema, 'check', [check])[0]!,
    page_results: valid(PageResultSchema, 'page_results', graded.pages),
    link_edges: valid(LinkEdgeSchema, 'link_edges', assembled.edges),
    access_tests: valid(AccessTestSchema, 'access_tests', assembled.access_tests),
    fixes: valid(FixSchema, 'fixes', diff.fixes),
    fix_events: valid(FixEventSchema, 'fix_events', diff.events),
    changes: valid(ChangeSchema, 'changes', diff.changes),
    lineages: {
      grading: valid(MeasurementLineageSchema, 'lineages.grading', [lineages.grading])[0]!,
      fetching: valid(MeasurementLineageSchema, 'lineages.fetching', [lineages.fetching])[0]!,
    },
    usage_event: usage === null ? null : valid(UsageEventSchema, 'usage_event', [usage])[0]!,
    diff_inputs,
    grades: graded.grades,
    summaries: summariesOf(
      check,
      assembled,
      graded,
      diff,
      { sitemap: input.seeds.filter((s) => s.source === 'sitemap').length },
      { crawl: batches.crawl.length, access: batches.access.length },
      rendered,
    ),
  };
}

/**
 * A built check as JSON, the same bytes for the same input: Maps (in `grades`) as their entries in
 * key order, and nothing else rewritten. The golden test compares this with expected.json.
 */
export function serialiseBuilt(built: BuiltCheck): string {
  return `${JSON.stringify(
    built,
    (_key, value: unknown) =>
      value instanceof Map
        ? Object.fromEntries([...value.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        : value instanceof Set
          ? [...value].sort()
          : value,
    2,
  )}\n`;
}
