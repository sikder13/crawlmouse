/**
 * Real checks for the public check tests (CC-22b): the engine's build of a BuildInput persisted into
 * PGlite with its map drawing stored, and `PublicCheckDeps` over that database as production wires
 * them (membership answered by the caller's own role under RLS, the plan from the account's row).
 */
import type { PGlite } from '@electric-sql/pglite';
import {
  buildCheck,
  checkMap,
  type BuildInput,
  type BuiltCheck,
} from '@crawlmouse/engine/v2/pipeline';
import type { BatchResult } from '@crawlmouse/types/v2';
import { recordedBuild } from '../../../../../../packages/engine/fixtures/v2/build/recorded';
import { asRole } from '../../../../__tests__/helpers/pglite-migrations';
import { putJson } from '../evidence';
import { ACCOUNT_CLOCK_COLUMNS, clockFromAccountRow, fixPlanOf } from '../load-for';
import { pageVantage, persistBuiltCheck } from '../persist';
import type { PublicCheckDeps } from '../public';
import { evidencePath, type EvidenceStore } from '../types';
import { memoryEvidenceStore } from './memory-evidence';
import { pgliteCheckReader, pglitePersistDb, seedRunning, seedSite } from './pglite';

export const FIRST = recordedBuild().check.id;
export const SECOND = 'b0000000-0000-4000-8000-0000000000c2';
const HOME = 'https://built-site.test';
const ORPHAN = `${HOME}/products/forgotten-lantern`;

/** `isMember` as production answers it: the caller's own role reads the site, under RLS. */
export const memberUnderRls = (db: PGlite) => (siteId: string, userId: string) =>
  asRole(db, 'authenticated', userId, async (tx) => {
    const { rows } = await tx.query(`select id from public.sites where id = $1`, [siteId]);
    return rows.length === 1;
  });

/** `planOf` as production answers it: the account's row through the service role. */
export const planFromDb =
  (db: PGlite, now: () => number): PublicCheckDeps['planOf'] =>
  async (accountId) => {
    const { rows } = await db.query<{ row: Record<string, unknown> }>(
      `select to_jsonb(a) as row from (select ${ACCOUNT_CLOCK_COLUMNS} from public.accounts where id = $1) a`,
      [accountId],
    );
    if (!rows[0]) throw new Error(`no account ${accountId}`);
    return fixPlanOf(clockFromAccountRow(rows[0].row), new Date(now()));
  };

export interface TestDeps extends PublicCheckDeps {
  evidence: EvidenceStore & { readonly objects: Map<string, Uint8Array> };
}

export function publicDeps(db: PGlite, now: () => number): TestDeps {
  return {
    read: pgliteCheckReader(db),
    evidence: memoryEvidenceStore(),
    isMember: memberUnderRls(db),
    planOf: planFromDb(db, now),
    now,
  };
}

const crawlPages = (batches: readonly unknown[]) =>
  (batches as BatchResult[]).flatMap((b) => (b.kind === 'crawl' ? b.pages : []));

/**
 * Builds `input` with the engine, persists it over a running check row and stores its map drawing
 * as the pipeline's finish step does. The site row is seeded unless `siteSeeded`.
 */
export async function persistBuild(
  db: PGlite,
  evidence: EvidenceStore,
  input: BuildInput,
  { siteSeeded = false, map = true }: { siteSeeded?: boolean; map?: boolean } = {},
): Promise<BuiltCheck> {
  const built = buildCheck(input);
  if (!siteSeeded) await seedSite(db, input.site);
  await seedRunning(db, input.check);
  const owner = {
    accountId: input.site.account_id,
    siteId: input.site.id,
    checkId: input.check.id,
  };
  const map_path = map ? evidencePath(owner, 'map') : null;
  if (map_path) await putJson(evidence, map_path, checkMap(built.page_results, built.link_edges));
  await persistBuiltCheck(pglitePersistDb(db), {
    built,
    vantage: pageVantage(crawlPages(input.batches)),
    map_path,
  });
  return built;
}

/**
 * The recorded site's second check, as recheck.test.ts builds one: the recorded crawl with a link
 * from the homepage to the planted orphan, so the first check's orphan fix resolves, and no access
 * batch, so it ends partial.
 */
export function secondInput(first: BuiltCheck): BuildInput {
  const input = recordedBuild();
  const batches = (
    JSON.parse(JSON.stringify(input.batches).replaceAll(FIRST, SECOND)) as BatchResult[]
  ).flatMap((b): BatchResult[] => {
    if (b.kind !== 'crawl') return [];
    if (!b.pages.some((p) => p.url === HOME)) return [b];
    return [
      {
        ...b,
        pages: b.pages.map((p) =>
          p.url === HOME && p.links_read ? { ...p, links_out: (p.links_out ?? 0) + 1 } : p,
        ),
        link_edges: [
          ...b.link_edges,
          {
            check_id: SECOND,
            from_url: HOME,
            to_url: ORPHAN,
            anchor_text: 'the forgotten lantern',
            is_generic_anchor: false,
            js_only: false,
          },
        ],
      },
    ];
  });
  return {
    ...input,
    check: {
      ...input.check,
      id: SECOND,
      previous_check_id: FIRST,
      trigger: 'fix_recheck',
      queued_at: '2026-11-06T10:00:00Z',
      started_at: '2026-11-06T10:00:02Z',
      finished_at: '2026-11-06T10:11:00Z',
      expires_at: '2026-12-06T10:00:00Z',
    },
    previous: { check: first.check, ...first.diff_inputs },
    fixes: first.fixes,
    events: first.fix_events,
    batches,
    render: null,
    now: '2026-11-06T10:11:00Z',
  };
}

/** Gives the site to `accountId` and clears its checks' expiry, as a Keep leaves them. */
export async function keepSite(db: PGlite, siteId: string, accountId: string): Promise<void> {
  await db.query(`update public.sites set account_id = $1 where id = $2`, [accountId, siteId]);
  await db.query(`update public.checks set expires_at = null where site_id = $1`, [siteId]);
}
