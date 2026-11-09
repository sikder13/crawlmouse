import type { PGlite } from '@electric-sql/pglite';
import { buildCheck, type BuildInput, type BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import type { BatchResult, Fix, FixEvent } from '@crawlmouse/types/v2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { loadCheck } from './load';
import { pageVantage, persistBuiltCheck } from './persist';
import { pgliteCheckReader, pglitePersistDb, seedRunning, seedSite } from './test-support/pglite';
import type { CheckDataset, PersistOutcome } from './types';

/**
 * The re-check path of the one writer (D5): the second check of a site. Persisting it takes the paths
 * a first check does not: the site's fixes are upserted over the rows the first check wrote, fix
 * events are appended to theirs, its changes name the first check, and the check row's
 * previous_check_id is written.
 *
 * The first check is the engine's build of the recorded site. The second is built from it as the
 * pipeline builds one (`previous` is the first check with its diff inputs; `fixes` and `events` are
 * the first check's), over the recorded crawl with one more link: from the homepage to the planted
 * orphan, so its orphan fix resolves. The expected rows are the builder's own output for both checks,
 * computed here without a database.
 *
 * The second check leaves out the recorded access batches (the new link moves the access sample, which
 * the recorded batches no longer match), so it ends partial and its crawler-access fix is
 * indeterminate. The new link's anchor is generic and one recorded edge is flagged js_only, so the two
 * flags of link_edges differ on its rows.
 */

const FIRST = recordedBuild().check.id;
const SECOND = 'b0000000-0000-4000-8000-0000000000c2';
const HOME = 'https://built-site.test';
const ORPHAN = `${HOME}/products/forgotten-lantern`;
/** The recorded edge flagged js_only on the second check. */
const JS_ONLY_TO = `${HOME}/collections/camp-lighting`;

/** The recorded crawl renamed to the second check, with the homepage's new link. */
function secondCrawl(): BatchResult[] {
  const renamed = JSON.parse(
    JSON.stringify(recordedBuild().batches).replaceAll(FIRST, SECOND),
  ) as BatchResult[];
  return renamed.flatMap((b): BatchResult[] => {
    if (b.kind !== 'crawl') return [];
    if (!b.pages.some((p) => p.url === HOME)) return [b];
    return [
      {
        ...b,
        pages: b.pages.map((p) =>
          p.url === HOME ? { ...p, links_out: (p.links_out ?? 0) + 1 } : p,
        ),
        link_edges: [
          ...b.link_edges.map((e) =>
            e.from_url === HOME && e.to_url === JS_ONLY_TO ? { ...e, js_only: true } : e,
          ),
          {
            check_id: SECOND,
            from_url: HOME,
            to_url: ORPHAN,
            anchor_text: 'click here',
            is_generic_anchor: true,
            js_only: false,
          },
        ],
      },
    ];
  });
}

function secondInput(first: BuiltCheck): BuildInput {
  const input = recordedBuild();
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
    batches: secondCrawl(),
    render: null,
    now: '2026-11-06T10:11:00Z',
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** Timestamps as instants (the database writes them in its own spelling); everything else as it is. */
function normalize(v: unknown): unknown {
  if (typeof v === 'string' && ISO.test(v)) return Date.parse(v);
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]));
  return v;
}
const byId = <T extends { id: string }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

let first: BuiltCheck;
let second: BuiltCheck;
let db: PGlite;
let written: PersistOutcome;
let loaded: CheckDataset;
/** What persisting the two checks threw, kept for the first test below to name. */
let refused: unknown = null;
const orphanFix = () => first.fixes.find((f) => f.type === 'orphan_pages')!;

beforeAll(async () => {
  const recorded = recordedBuild();
  first = buildCheck(recorded);
  second = buildCheck(secondInput(first));
  db = await freshDb();
  await applyAllMigrations(db);
  await seedSite(db, recorded.site);
  await seedRunning(db, recorded.check);
  const crawl = (batches: readonly unknown[]) =>
    pageVantage((batches as BatchResult[]).flatMap((b) => (b.kind === 'crawl' ? b.pages : [])));
  try {
    await persistBuiltCheck(pglitePersistDb(db), {
      built: first,
      vantage: crawl(recorded.batches),
      map_path: null,
    });
    await seedRunning(db, secondInput(first).check);
    written = await persistBuiltCheck(pglitePersistDb(db), {
      built: second,
      vantage: crawl(secondCrawl()),
      map_path: null,
    });
    loaded = await loadCheck(pgliteCheckReader(db), SECOND);
  } catch (error) {
    refused = error;
  }
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe('the second check the builder made (what this file relies on)', () => {
  it('resolves the orphan fix: verified_resolved, not_detected, a verified event, a resolved change naming the first check', () => {
    const fix = second.fixes.find((f) => f.id === orphanFix().id)!;
    expect(orphanFix()).toMatchObject({ status: 'open', last_state: 'detected' });
    expect(fix).toMatchObject({
      status: 'verified_resolved',
      last_state: 'not_detected',
      last_measured_check_id: SECOND,
      first_seen_check_id: FIRST,
    });
    expect(second.fix_events).toContainEqual(
      expect.objectContaining({ fix_id: fix.id, kind: 'verified', check_id: SECOND }),
    );
    expect(second.changes).toContainEqual(
      expect.objectContaining({ fix_id: fix.id, kind: 'resolved', previous_check_id: FIRST }),
    );
    expect(second.check).toMatchObject({ previous_check_id: FIRST, status: 'partial' });
    expect(first.fix_events).toEqual([]);
  });

  it('has link edges with each flag set alone', () => {
    const flags = (e: { is_generic_anchor: boolean; js_only: boolean }) =>
      `${e.is_generic_anchor}/${e.js_only}`;
    expect(new Set(second.link_edges.map(flags))).toEqual(
      new Set(['false/false', 'true/false', 'false/true']),
    );
  });
});

describe('the second check, persisted over the first and read back', () => {
  it('is written, every fix upserted', () => {
    expect(refused).toBeNull();
    expect(written).toMatchObject({
      written: true,
      counts: {
        fixes: second.fixes.length,
        fix_events: second.fix_events.length,
        changes: second.changes.length,
      },
    });
    expect(second.fixes.length).toBeGreaterThan(0); // anti-vacuity
  });

  it('is the builder’s check, page results, link edges, access tests and changes', () => {
    expect(normalize(loaded.checks)).toEqual(normalize([second.check]));
    expect(normalize(loaded.page_results)).toEqual(normalize(second.page_results));
    expect(normalize(loaded.link_edges)).toEqual(normalize(second.link_edges));
    expect(normalize(loaded.access_tests)).toEqual(normalize(byId(second.access_tests)));
    expect(normalize(byId(loaded.changes))).toEqual(normalize(byId(second.changes)));
    expect(loaded.usage_events).toEqual([]);
    expect(loaded.sites).toEqual([recordedBuild().site]);
  });

  it('holds the site’s fixes as the two checks left them, and the events of both', async () => {
    const asLeft = new Map<string, Fix>(first.fixes.map((f) => [f.id, f]));
    for (const f of second.fixes) asLeft.set(f.id, f);
    expect(normalize(loaded.fixes)).toEqual(
      normalize([...asLeft.values()].sort((a, b) => a.number - b.number)),
    );
    const events: FixEvent[] = [...first.fix_events, ...second.fix_events];
    expect(normalize(byId(loaded.fix_events))).toEqual(normalize(byId(events)));
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.site_fixes where site_id = $1`,
      [second.check.site_id],
    );
    expect(rows[0]!.n).toBe(asLeft.size);
  });

  it('flips the orphan fix in its row, with its event and its change', () => {
    const id = orphanFix().id;
    expect(loaded.fixes.find((f) => f.id === id)).toMatchObject({
      status: 'verified_resolved',
      last_state: 'not_detected',
      last_measured_check_id: SECOND,
      first_seen_check_id: FIRST,
    });
    expect(loaded.fix_events).toContainEqual(
      expect.objectContaining({ fix_id: id, kind: 'verified', check_id: SECOND }),
    );
    expect(loaded.changes).toContainEqual(
      expect.objectContaining({ fix_id: id, kind: 'resolved', previous_check_id: FIRST }),
    );
    expect(loaded.checks[0]!.previous_check_id).toBe(FIRST);
  });

  it('reads the lineages the first check wrote, which the second names', () => {
    expect(second.lineages.grading.id).toBe(first.lineages.grading.id);
    expect(normalize(byId(loaded.lineages))).toEqual(
      normalize(byId([first.lineages.grading, first.lineages.fetching])),
    );
  });
});
