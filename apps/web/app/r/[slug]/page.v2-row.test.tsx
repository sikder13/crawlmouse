/**
 * v1's report page and a v2 row (correctness N7). With V2_CHECKS_PUBLIC on, the middleware rewrites
 * `/r/<slug>` to `/v2-report/<slug>`, but not every spelling: `rewriteOf` leaves a `.rsc` spelling
 * alone by design, and whether the platform then serves v1's page for it is not something a unit test
 * can see. So the guard is v1's page itself, unchanged (its hash is pinned in
 * `__tests__/v2/public-pages.test.tsx`): for a row holding a v2 snapshot it answers 404 and says
 * noindex, whatever the flag, because `isReportGone` (v1's reading) treats a row with no grade as gone.
 * The v2 surfaces read the same row through `isReportGoneEitherKind`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicReportRow } from '@/lib/reports';
import { buildOgReportModel } from '@/lib/og-report-model';
import { isReportGone, isReportGoneEitherKind } from '@/lib/report-visibility';
import { fixture } from '@/lib/v2/fixtures';
import { buildPublicSnapshot } from '@/lib/v2/reports/build-snapshot';
import { rewriteOf } from '@/lib/v2/rewrites';
import { reportPageOf } from '@/lib/v2/view/public-report';
import { FIRST_AUDIT } from '@/lib/v2/view/segment/test-helpers';

const store = vi.hoisted(() => ({ row: null as unknown }));
vi.mock('@/lib/reports', () => ({ getPublicReport: async () => store.row }));

const page = await import('./page');

/** A slug of `newReportSlug`'s shape: 22 characters of [0-9A-Za-z]. */
const SLUG = 'Ab3dEf6hIj9lMn2pQr5tUv';
const props = { params: Promise.resolve({ slug: SLUG }) };

const v2Row: PublicReportRow = {
  domain: 'example-outfitter.com',
  grade: null,
  score: null,
  cms_detected: null,
  orphan_count: null,
  avg_depth: null,
  takedown_requested_at: null,
  created_at: '2026-11-12T18:00:00.000Z',
  claimed_at: '2026-11-12T19:00:00.000Z',
  listed: true,
  indexable: true,
  hidden_at: null,
  white_label: null,
  report_snapshot: buildPublicSnapshot(
    fixture('bad-site'),
    FIRST_AUDIT['bad-site'],
    '2026-11-12T18:00:00.000Z',
  ) as unknown as PublicReportRow['report_snapshot'],
};

/** Next's notFound() throws an error whose digest names the 404 fallback. */
async function digestOf(render: () => unknown): Promise<string> {
  try {
    await render();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return 'rendered';
}

afterEach(() => {
  vi.unstubAllEnvs();
  store.row = null;
});

describe('the /r/ spellings the rewrite skips', () => {
  it.each([`/r/${SLUG}.rsc`, `/r/${SLUG}.rsc/`, `/r/${encodeURIComponent(SLUG)}.rsc`])(
    '%s is not rewritten, so it is left to whatever serves /r/<slug> without the middleware',
    (path) => {
      expect(rewriteOf(path)).toBeNull();
    },
  );

  it('the page spelling itself is rewritten (the case the guard below does not depend on)', () => {
    expect(rewriteOf(`/r/${SLUG}`)?.to).toBe(`/v2-report/${SLUG}`);
  });
});

describe.each([
  ['on', '1'],
  ['off', ''],
])('v1’s page given a live, claimed v2 row, V2_CHECKS_PUBLIC %s', (_state, flag) => {
  it('answers 404 rather than rendering ReportBody over a v2 snapshot', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', flag);
    store.row = v2Row;
    expect(await digestOf(() => page.default(props))).toContain('404');
  });

  it('says noindex', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', flag);
    store.row = v2Row;
    expect((await page.generateMetadata(props)).robots).toEqual({ index: false, follow: true });
  });

  it('draws the placeholder card, never a grade (og-report-model, correctness N6)', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', flag);
    expect(isReportGone(v2Row)).toBe(true);
    expect(buildOgReportModel(v2Row)).toEqual({ kind: 'placeholder' });
  });
});

describe('the v2 surfaces read the same row through isReportGoneEitherKind', () => {
  it('with the flag on it is live, and the v2 route renders it', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    expect(isReportGoneEitherKind(v2Row)).toBe(false);
    expect(reportPageOf(v2Row).kind).toBe('v2');
  });

  it('with the flag off it is gone there too', () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    expect(isReportGoneEitherKind(v2Row)).toBe(true);
    expect(reportPageOf(v2Row).kind).toBe('gone');
  });
});
