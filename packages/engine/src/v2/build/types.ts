/**
 * What the check builder reads and returns (CC-20a). `buildCheck` is a pure function of a BuildInput:
 * the same input gives byte-identical output (`serialiseBuilt`). Everything in BuiltCheck except
 * `grades` and `summaries` is a contract row, parsed with its schema before it is returned.
 */
import type {
  AccessTest,
  Change,
  Check,
  Fix,
  FixEvent,
  LinkEdge,
  MeasurementLineage,
  PageResult,
  Site,
  UsageEvent,
} from '@crawlmouse/types/v2';
import type { CheckSide } from '../diff/types.js';
import type { Grades } from '../grade/index.js';
import type { RenderOutcome } from '../render/run.js';

type CheckTrigger = Check['trigger'];
type CheckPhase = NonNullable<Check['progress']>['steps'][number]['phase'];

/** A URL the crawl was seeded with, and where it came from: the site's sitemap, or the homepage. */
export interface Seed {
  url: string;
  source: 'homepage' | 'sitemap';
  /** The sitemap's `<lastmod>` as a date (YYYY-MM-DD); null when it gives none. */
  lastmod: string | null;
}

export interface BuildInput {
  check: {
    id: string;
    site_id: string;
    previous_check_id: string | null;
    trigger: CheckTrigger;
    queued_at: string;
    started_at: string;
    finished_at: string;
    /** When an audit nobody keeps stops being visible; set when the check was created. */
    expires_at: string | null;
    /** The most pages the crawl was allowed to fetch. */
    page_cap: number;
    /** Must be the engine's GRADE_VERSION: the builder grades with this engine, and says so. */
    grade_version: string;
  };
  site: Site;
  /** The URL the crawl started from, in the engine's canonical spelling. */
  homepage_url: string;
  /** The crawl's seeds: the homepage and the sitemap's URLs, as CC-20b's discovery read them. */
  seeds: readonly Seed[];
  /** Every crawl and access batch result of the check, parsed here with BatchResultSchema. */
  batches: readonly unknown[];
  /** The render step's outcome over `renderCandidates`; null when the check rendered nothing. */
  render: RenderOutcome | null;
  /** The site's last graded check, as diffCheck reads it (its `diff_inputs` and Check); null if none. */
  previous: CheckSide | null;
  /** The site's fixes, and every event of them, before this check. */
  fixes: readonly Fix[];
  events: readonly FixEvent[];
  lineage: {
    /** The git commit the engine was built from. */
    engine_sha: string;
    /** The worker build every batch came from; the builder refuses batches from another. */
    worker_release: string;
  };
  /** When the lineage row is minted. */
  now: string;
}

/**
 * What the next check's diff needs of this one that the Check record does not carry: CC-20b persists
 * it with the check (migration 008) and passes it back as the next BuildInput's `previous`.
 */
export type DiffInputs = Omit<CheckSide, 'check'>;

/** What one pipeline step returns to Inngest: a few counts, under SUMMARY_BYTES as JSON. */
export interface PhaseSummary {
  phase: CheckPhase;
  [count: string]: string | number | boolean | null | readonly string[];
}

export interface BuiltCheck {
  check: Check;
  page_results: PageResult[];
  link_edges: LinkEdge[];
  access_tests: AccessTest[];
  /** CC-19's DiffResult rows, unchanged. */
  fixes: Fix[];
  fix_events: FixEvent[];
  changes: Change[];
  /**
   * What produced the check (06b §1): `grading`, with no worker, which `checks.lineage_id` names; and
   * `fetching`, with the worker release, which the page, link and access rows name.
   */
  lineages: { grading: MeasurementLineage; fetching: MeasurementLineage };
  /** Null for a site no account keeps: an anonymous audit is not metered (UsageEventSchema needs an account). */
  usage_event: UsageEvent | null;
  diff_inputs: DiffInputs;
  /** CC-17's grades, as gradeCheck returned them. */
  grades: Grades;
  summaries: PhaseSummary[];
}
