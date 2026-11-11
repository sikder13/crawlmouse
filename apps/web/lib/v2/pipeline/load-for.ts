/**
 * `loadCheckFor` (CC-22b D3): what `/audit/[id]` and its sub-pages show for an id and a viewer.
 *
 * `readableCheck` decides whether the viewer may read the check at all (null is a 404). After it, in
 * this order: a check past its `expires_at` is `expired`, whatever its status (its `finishedAt` is
 * set for a finished or partial check, which is what the page calls crawled); a queued, running or
 * deferred one is `waiting`; a failed one is `failed` with its stored reason; a finished or partial
 * one is `ready`, with the dataset `loadCheck` reads, the site's checks queued at or before this one
 * (the views look other checks up by id and read `checks` as the site's history), the plan that
 * decides which fixes open, and the stored map drawing.
 */
import type { MapDrawing } from '@crawlmouse/engine/v2/pipeline';
import { FixtureDatasetSchema, instant } from '@crawlmouse/types/v2';
import { z } from 'zod';
import { effectiveTier, type EntitlementClock } from '../../entitlement-v2';
import { gunzipJson } from './evidence';
import { loadCheck } from './load';
import {
  isExpired,
  readableCheck,
  type CheckAccess,
  type CheckRead,
  type FixPlan,
  type PublicCheckDeps,
  type Viewer,
} from './public';
import { checkFromRow } from './rows';
import type { CheckDataset } from './types';

const CheckDatasetSchema = FixtureDatasetSchema.extend({ provenance: z.literal('measured') });

const PointSchema = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
const MapDrawingSchema = z.strictObject({
  version: z.literal(1),
  nodes: z.array(
    z.strictObject({
      id: z.string().min(1),
      parent: z.string().min(1).nullable(),
      depth: z.number().int().nonnegative().nullable(),
      kind: z.enum(['page', 'orphan', 'js_only']),
      via: z.enum(['link', 'javascript']).nullable(),
    }),
  ),
  positions: z.record(z.string(), PointSchema),
});

/**
 * The stored drawing at `path`, or null: no path, an object that cannot be read or unzipped, JSON of
 * another shape, or a drawing that has a node with no position.
 */
export async function storedDrawing(
  evidence: PublicCheckDeps['evidence'],
  path: string | null,
): Promise<MapDrawing | null> {
  if (path === null) return null;
  try {
    const parsed = MapDrawingSchema.safeParse(gunzipJson(await evidence.get(path)));
    if (!parsed.success) return null;
    const drawing = parsed.data;
    return drawing.nodes.every((n) => Object.hasOwn(drawing.positions, n.id)) ? drawing : null;
  } catch {
    return null;
  }
}

/** What an account's tier opens of a check's fixes at `now`: Free the Free three, a paid tier each. */
export const fixPlanOf = (account: EntitlementClock, now: Date): FixPlan =>
  effectiveTier(account, now) === 'free' ? 'free' : 'pro';

const date = (value: unknown): Date | null => (typeof value === 'string' ? new Date(value) : null);

/** An `accounts` row's entitlement columns, as PostgREST returns them, as the clock `effectiveTier` reads. */
export function clockFromAccountRow(row: Record<string, unknown>): EntitlementClock {
  return {
    state: row.state as EntitlementClock['state'],
    tier: row.tier as EntitlementClock['tier'],
    pastDueTier: (row.past_due_tier ?? null) as EntitlementClock['pastDueTier'],
    pastDueSince: date(row.past_due_since),
    trialVariant: (row.trial_variant ?? null) as EntitlementClock['trialVariant'],
    trialEndsAt: date(row.trial_ends_at),
  };
}

/** The columns `clockFromAccountRow` reads. */
export const ACCOUNT_CLOCK_COLUMNS =
  'state, tier, past_due_tier, past_due_since, trial_variant, trial_ends_at';

async function readyDataset(
  deps: Pick<PublicCheckDeps, 'read'>,
  access: CheckAccess,
): Promise<CheckDataset> {
  const [dataset, siteChecks] = await Promise.all([
    loadCheck(deps.read, access.checkId),
    deps.read.rows('checks', 'site_id', [access.siteId]),
  ]);
  const until = instant(access.queuedAt);
  const checks = siteChecks
    .map(checkFromRow)
    .filter((c) => instant(c.queued_at) <= until)
    .sort(
      (a, b) =>
        instant(a.queued_at) - instant(b.queued_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  return CheckDatasetSchema.parse({ ...dataset, checks });
}

export async function loadCheckFor(
  deps: PublicCheckDeps,
  id: string,
  viewer: Viewer,
): Promise<CheckRead | null> {
  const access = await readableCheck(deps, id, viewer);
  if (access === null) return null;
  const { checkId, host } = access;
  const kept = access.accountId !== null;

  if (isExpired(access, deps.now())) {
    return {
      state: 'expired',
      checkId,
      host,
      expiredAt: access.expiresAt!,
      // When it was graded. A failed check's row has a finish time too: the time it stopped.
      finishedAt:
        access.status === 'finished' || access.status === 'partial' ? access.finishedAt : null,
    };
  }
  const { status } = access;
  if (status === 'queued' || status === 'running' || status === 'deferred') {
    return {
      state: 'waiting',
      checkId,
      host,
      status,
      queuedAt: access.queuedAt,
      startedAt: access.startedAt,
      progress: access.progress,
      kept,
    };
  }
  if (status === 'failed') {
    return {
      state: 'failed',
      checkId,
      host,
      failedAt: access.finishedAt ?? access.queuedAt,
      // A stored word that is not one of the pipeline's reasons is shown as its catch-all.
      reason: access.failureReason ?? 'internal',
      kept,
    };
  }
  const [dataset, map, plan] = await Promise.all([
    readyDataset(deps, access),
    storedDrawing(deps.evidence, access.mapPath),
    access.accountId === null ? ('free' as const) : deps.planOf(access.accountId),
  ]);
  return { state: 'ready', checkId, host, kept, plan, dataset, map };
}
