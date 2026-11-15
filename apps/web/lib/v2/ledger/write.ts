/**
 * The research ledger's writer (CC-41 D4; docs/specs/v2/06b-data-foundations.md §9, "write the ledger
 * rows in a transaction of their own").
 *
 * `writeLedger` records one ended check: it reads the check's row, its site and its draft, and calls
 * `record_check_ledger`, which writes the run, its observations and the check's link in one
 * transaction and deletes the draft. It runs after the check's finalize, from its own Inngest function
 * (inngest/ledger.ts), so nothing it does can fail, delay or change the check.
 *
 * It writes nothing, and says why, when: there is no usable RESEARCH_SITE_KEY (`no_key`); the check is
 * gone, has a link already, has not ended as finished or partial, has no lineage, or has no draft;
 * or its site's account is internal (`internal`: the draft is deleted, so no later run reads it).
 * The rows hold no account, user, email, check id, URL, path or host, and no time finer than the
 * month: the run is the draft's fields, the site key, its version, the check's lineage and month.
 *
 * `backfillLedger` is the one retry: the backfill runs every BACKFILL_EVERY_HOURS hours and writes the
 * checks whose draft was stored in the BACKFILL_EVERY_HOURS hours that ended one hour before its run,
 * so each draft falls in exactly one run's window.
 */
import { LedgerDraftSchema, type LedgerDraft, type Observation } from './draft';
import { SITE_KEY_VERSION, siteKeyFor, siteKeySecretOk } from './site-key';

export interface LedgerSource {
  status: string;
  lineageId: string | null;
  /** `checks.check_month`: the first of the check's month, `YYYY-MM-01`. */
  month: string;
  host: string;
  accountId: string | null;
  linked: boolean;
  draft: unknown | null;
}

export interface LedgerRun extends Omit<LedgerDraft, 'observations'> {
  observed_month: string;
  site_key: string;
  site_key_version: number;
  lineage_id: string;
}

export interface LedgerStore {
  source(checkId: string): Promise<LedgerSource | null>;
  /** Whether an account is marked internal; throws when it cannot tell. */
  internal(accountId: string): Promise<boolean>;
  record(checkId: string, run: LedgerRun, observations: readonly Observation[]): Promise<void>;
  dropDraft(checkId: string): Promise<void>;
  /** Checks whose draft was stored in `[from, to)`, oldest first. */
  draftedBetween(from: Date, to: Date, limit: number): Promise<string[]>;
}

export type LedgerOutcome =
  | 'written'
  | 'no_key'
  | 'gone'
  | 'already_linked'
  | 'not_ended'
  | 'no_lineage'
  | 'no_draft'
  | 'internal';

export interface WriterDeps {
  store: LedgerStore;
  /** RESEARCH_SITE_KEY, as the environment holds it. */
  secret: string | undefined;
}

const ENDED = new Set(['finished', 'partial']);

export async function writeLedger(deps: WriterDeps, checkId: string): Promise<LedgerOutcome> {
  const secret = deps.secret;
  if (!siteKeySecretOk(secret)) return 'no_key';
  const src = await deps.store.source(checkId);
  if (src === null) return 'gone';
  if (src.linked) return 'already_linked';
  if (!ENDED.has(src.status)) return 'not_ended';
  if (src.lineageId === null) return 'no_lineage';
  if (src.draft === null) return 'no_draft';
  if (src.accountId !== null && (await deps.store.internal(src.accountId))) {
    await deps.store.dropDraft(checkId);
    return 'internal';
  }
  const siteKey = siteKeyFor(src.host, secret);
  const { observations, ...fields } = LedgerDraftSchema.parse(src.draft);
  await deps.store.record(
    checkId,
    {
      ...fields,
      observed_month: src.month,
      site_key: siteKey,
      site_key_version: SITE_KEY_VERSION,
      lineage_id: src.lineageId,
    },
    observations,
  );
  return 'written';
}

/** The most checks one backfill run writes. */
export const BACKFILL_LIMIT = 200;
/** The backfill's period, which inngest/ledger.ts's cron repeats, and so the length of its window. */
export const BACKFILL_EVERY_HOURS = 6;
const HOUR_MS = 60 * 60 * 1000;

export interface BackfillResult {
  outcomes: Partial<Record<LedgerOutcome, number>>;
  failed: number;
  /** True when the window held more than BACKFILL_LIMIT drafts: the rest are not retried. */
  bounded: boolean;
}

/** Writes the checks drafted in the BACKFILL_EVERY_HOURS hours ending one hour before `now`, bounded. */
export async function backfillLedger(
  deps: WriterDeps & { onFailure: (checkId: string, error: unknown) => void },
  now: Date,
  limit = BACKFILL_LIMIT,
): Promise<BackfillResult> {
  const result: BackfillResult = { outcomes: {}, failed: 0, bounded: false };
  const to = new Date(now.getTime() - HOUR_MS);
  const from = new Date(to.getTime() - BACKFILL_EVERY_HOURS * HOUR_MS);
  const ids = await deps.store.draftedBetween(from, to, limit + 1);
  result.bounded = ids.length > limit;
  for (const checkId of ids.slice(0, limit)) {
    try {
      const outcome = await writeLedger(deps, checkId);
      result.outcomes[outcome] = (result.outcomes[outcome] ?? 0) + 1;
    } catch (error) {
      result.failed += 1;
      deps.onFailure(checkId, error);
    }
  }
  return result;
}
