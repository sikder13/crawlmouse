import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CheckRequested } from '../../../../../../inngest/check-events';
import { persistAll } from '../../../../../../inngest/check';
import { applyAllMigrations, freshDb } from '../../../../__tests__/helpers/pglite-migrations';
import { putJson } from '../evidence';
import { PIECE_CUT, persistCalls } from '../persist';
import { largeBuiltInput, largeBuiltSeed } from '../test-support/large-built';
import { memoryEvidenceStore } from '../test-support/memory-evidence';
import { pglitePersistDb, seedRunningCheck } from '../test-support/pglite';
import type { StepDeps } from './deps';
import { finishSteps } from './finish';
import { pathOf } from './stored';

/**
 * QA B2 on #219: a check of more than PIECES_PER_STEP pieces persisted through the real wiring, the
 * Inngest loop (`persistAll`, inngest/check.ts) driving the real persist step (steps/finish.ts) over
 * PGlite, so a step that starts from the wrong piece or drops `next` fails here. `run` runs each
 * step's body at once and records its id, as Inngest does on the step's first invocation.
 */

const PAGES = 2_000;
/** Enough edges that the rows are more than one step's pieces at this release's cut. */
const EDGES = 80_000;

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 180_000);
afterAll(async () => {
  await db.close();
});

describe('the persist steps, through persistAll and finish.ts', () => {
  it('a check of more than PIECES_PER_STEP pieces takes persist, then persist-1 from where it stopped, and stores every row', async () => {
    const { site, check } = largeBuiltSeed();
    await seedRunningCheck(db, site, check);
    const input = largeBuiltInput(PAGES, EDGES);
    const pieces = persistCalls(input).pieces.length;
    expect(pieces, 'anti-vacuity: more than one step of pieces').toBeGreaterThan(PIECE_CUT.perStep);
    const event: CheckRequested = {
      checkId: check.id,
      siteId: site.id,
      accountId: site.account_id,
      host: site.host,
      homepageUrl: `https://${site.host}/`,
      trigger: check.trigger,
      pageCap: PAGES,
    };
    const evidence = memoryEvidenceStore();
    await putJson(evidence, pathOf(event, 'built'), {
      built: input.built,
      vantage: [...input.vantage],
      read: input.read,
      cut: PIECE_CUT,
    });
    const deps = { evidence, persistDb: pglitePersistDb(db) } as unknown as StepDeps;
    const ids: string[] = [];
    const run = <T>(id: string, fn: () => Promise<T>): Promise<T> => {
      ids.push(id);
      return fn();
    };
    const out = await persistAll(run, finishSteps(deps), event);
    expect(out.written).toBe(true);
    const steps = Math.ceil(pieces / PIECE_CUT.perStep);
    expect(ids).toEqual([
      'persist',
      ...Array.from({ length: steps - 1 }, (_, k) => `persist-${k + 1}`),
    ]);
    const { rows } = await db.query<{ status: string; pages: number; edges: number }>(
      `select c.status,
              (select count(*)::int from public.page_results p where p.check_id = c.id) as pages,
              (select count(*)::int from public.link_edges e where e.check_id = c.id) as edges
         from public.checks c where c.id = $1`,
      [check.id],
    );
    expect(rows[0]).toEqual({ status: input.built.check.status, pages: PAGES, edges: EDGES });
  }, 180_000);
});
