// @vitest-environment jsdom
//
// ─────────────────────────────────────────────────────────────────────────────
// THE FILE NO TEST LOADED — NOW DRIVEN BY THE PRODUCER THAT FEEDS IT.
//
// Two rounds of history are load-bearing here, and skipping either one re-opens a defect.
//
// GATE 7. `AuditView.tsx` was imported by `page.tsx` and by NOTHING ELSE. An unconditional `throw` at
// its module scope left the whole web suite green — measured — so every claim four gates had made
// about its contents was a claim about source text. That is why evasions kept surviving after the
// render decision had already been moved into executable code: the decision moved, and the last
// unexecuted thing left was the PROPS this component hands it.
//
// GATE 8. Making it executable was necessary and not sufficient. The first version of this file drove
// a stream of LENGTH ONE — `mount()` then a single `done`. So the only thing `setSnapshot` does,
// REPLACE THE PREVIOUS PAYLOAD, was never asserted, and two edits survived the whole suite with `tsc`
// and `eslint` clean:
//
//     onSnapshot: (payload) => setSnapshot((prev) => prev ?? (payload as Snapshot))
//     const viewSnapshot = useMemo(() => snapshot, [snapshot?.id]);   // incomplete dep array
//
// Both put the pre-5.1 failure card back on every refused audit. The second is an ordinary React
// refactor, and `react-hooks/exhaustive-deps` cannot catch it here because `next lint` reports "The
// Next.js plugin was not detected in your ESLint configuration".
//
// WHY IT SURVIVED: THE FIXTURE WAS A SHAPE THE PRODUCT NEVER PRODUCES. `stream/route.ts:262` sends
// `snapshot` UNCONDITIONALLY on every connection before any `done`; `:288` sends `progress` on every
// poll tick; even the already-completed short-circuit sends `snapshot` then `done`. A single-`done`
// stream does not exist in production. That is the exact defect `refused-route.test.tsx`'s own header
// names — "a fixture that outruns its loader proves a state the product never enters" — and it had
// reappeared inside the file written to close it.
//
// THE FIX IS THE MEDIUM, NOT MORE CASES. These fixtures are no longer written by hand. Each scenario
// RUNS THE REAL `GET` ROUTE against a stubbed database, captures the raw SSE bytes it emits, and
// replays that exact sequence — event names and serialized payloads unchanged — into a mounted
// `AuditView`. A fixture cannot drift from the producer because it IS the producer's output. If
// someone reorders, adds or removes an emission in `stream/route.ts`, every replay below changes with
// it, with nothing here to update.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextRequest } from 'next/server';

vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
// The graph canvas is dynamically imported by LinkGraphSlot AFTER mount. Under jsdom that import
// would really pull in react-force-graph-2d and a canvas backend; the slot's own tests cover it.
vi.mock('@/components/audit/LinkGraph', () => ({ LinkGraph: () => null }));

// ── The stubbed database the REAL route reads ────────────────────────────────
// Only the DB is stubbed. Everything between it and the wire — AUDIT_COLS, projectAuditForClient,
// buildDone, the entitlement gate, the emission order — is the shipped code.
let auditRow: Record<string, unknown>;
let convRow: Record<string, unknown> | null;
let findingsThrow = false;
/** Zero-page rows must read as genuinely empty, not as the canned 2-page result set. */
let emptyResults = false;
/** Rows the poll loop returns in order; when exhausted the last one repeats. */
let pollRows: Array<Record<string, unknown>> | null = null;
let readCount = 0;

const aiSig = () => ({
  pageClass: 'readable', mainTextChars: 400, title: 'T', excerpt: 'x', csrSignals: [], frameworkMarker: null,
  hasTitle: true, hasMetaDescription: true, h1Count: 1, headingLevelsSkipped: false, hasMainLandmark: true,
  jsonLd: { present: true, valid: true, types: ['Organization'], hasEntityType: true },
});
const cannedPages = [
  { id: 'p1', url: 'https://x.com', title: 'Home', depth: 0, is_orphan: false, pagerank: 0.9, in_degree: 2, out_degree: 1, excluded_from_grade: false, ai_signals: aiSig() },
  { id: 'p2', url: 'https://x.com/o', title: 'Orphan', depth: 1, is_orphan: true, pagerank: 0.1, in_degree: 1, out_degree: 0, excluded_from_grade: false, ai_signals: aiSig() },
];
const freeFixRow = {
  fix_id: 'orphan:https://x.com/o', category: 'orphan', target_url: 'https://x.com/o', target_title: 'Orphan',
  marginal_delta: 5, effort: 'low', rationale: 'no inbound', rank: 1, is_free_fix: true,
  suggested_links: [{ fromUrl: 'https://x.com/', fromTitle: 'Home', anchorText: 'the orphaned page', relevanceScore: 0.8 }],
  action_packet_body: 'FREE TASTE BODY',
};

vi.mock('@/lib/supabase/fetch-all', () => ({
  POSTGREST_PAGE: 1000,
  fetchAll: (_c: unknown, table: string) => {
    // Models `buildDone` throwing mid-assembly — the path that makes the route emit a NAMED `error`
    // instead of `done`, leaving the client holding the BASE payload (gate 7 / B4).
    if (table === 'findings' && findingsThrow) return Promise.reject(new Error('results read failed'));
    if (emptyResults) return Promise.resolve([]);
    if (table === 'findings') return Promise.resolve([{ category: 'orphan', severity: 'critical', pages: { url: 'https://x.com/o' } }]);
    if (table === 'pages') return Promise.resolve(cannedPages);
    if (table === 'links') return Promise.resolve([{ from_page_id: 'p1', to_page_id: 'p2' }]);
    if (table === 'fixes') return Promise.resolve([freeFixRow]);
    return Promise.resolve([]);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      let selectCols = '';
      const chain = {
        select: (cols: string) => { selectCols = cols; return chain; },
        eq: () => chain,
        maybeSingle: () => {
          if (table === 'audits') {
            if (selectCols.includes('confidence_band')) return Promise.resolve({ data: convRow, error: null });
            if (selectCols.includes('failure_reason')) {
              const row = pollRows ? (pollRows[readCount] ?? pollRows[pollRows.length - 1]) : auditRow;
              readCount += 1;
              return Promise.resolve({ data: row, error: null });
            }
          }
          return Promise.resolve({ data: null, error: null });
        },
        range: () => Promise.resolve({ data: [], error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: () => Promise.resolve({
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    from: () => { const c = { select: () => c, eq: () => c, maybeSingle: () => Promise.resolve({ data: null, error: null }) }; return c; },
  }),
}));

import { GET } from '@/app/api/audits/[id]/stream/route';
import { AuditView } from './AuditView';
import { NO_GRADE_LABEL } from '@/lib/refusal-copy';

/** The pre-5.1 failure copy — the invented cause this spec exists to delete from a refusal. */
const INVENTED_CAUSE = 'usually a site that blocks crawlers';
const COULD_NOT_GRADE = 'Couldn’t grade this site';
/** Uniquely `ResultView`'s free-cure card: on the v2 arc, absent from the legacy GradeCard. */
const V2_ARC_MARKER = 'the orphaned page';

interface Emission { event: string; data: string }

/**
 * Run the REAL SSE route and return the events it emitted, in order, with payloads exactly as
 * serialized. This is the producer; everything below replays what it says.
 */
async function captureFromRoute(id = 'aud-1'): Promise<Emission[]> {
  const res = await GET(new NextRequest(`http://localhost/api/audits/${id}/stream`), { params: Promise.resolve({ id }) });
  const raw = await res.text();
  return raw
    .split('\n\n')
    .filter((b) => b.startsWith('event: '))
    .map((b) => ({ event: b.slice(7, b.indexOf('\n')), data: b.slice(b.indexOf('data: ') + 6) }));
}

// ── Row fixtures. Only the DB rows are hand-written; every wire payload is produced. ─────────────
const REFUSED_ROW = {
  id: 'aud-1', url: 'https://x.com/', status: 'completed', grade: null, score: null, page_count: 2, link_count: 1,
  cms_detected: 'custom', user_id: null, settings: { pageCap: 500 }, failure_reason: null,
  confidence: 'high', coverage_pct: '1', block_rate: '0', partial: false,
  refusal: { refused: true, triggers: ['site_too_small_to_measure'], confidenceCapped: false, unevaluable: [] },
  coverage: { fetched: 3, gradeable: 3, excluded: [], sitemapDeclared: null, sitemapRobotsExcluded: null, estimatedTotal: 3, estimateSource: 'frontier', coverageRatio: 1 },
  discovered_count: 3, blocked_count: 0,
};
const GRADED_ROW = { ...REFUSED_ROW, grade: 'C', score: '64.00', refusal: null, coverage: null };
const RUNNING_ROW = { ...REFUSED_ROW, status: 'running', grade: null, score: null, refusal: null, coverage: null };

// ── THE ROW-SHAPE MATRIX ─────────────────────────────────────────────────────
// GATE 9 / NB-1. The stream was the producer's, but the ROW SHAPE was one hand-picked singleton
// (`confidence:'high'`, `partial:false`, 2 pages, 1 finding, anonymous viewer). A one-line edit
// conditioned on anything outside that shape was therefore invisible — measured: nulling crawlHealth
// only when `confidence === 'low'` left all 1552 web tests, `tsc` and `eslint` clean while rendering
// gate 3's blocker. Reachability was not hypothetical: of the 51 production audits that would refuse,
// **13 carry confidence='low' and 4 'medium'** — a third of refusals sat outside the pinned shape.
//
// The fix is shapes, not cases. Every combination below is a row the engine really writes, and the
// refusal assertions run over all of them, so an edit keyed on ANY of these fields is caught by
// construction rather than by someone having predicted that field.
const CONFIDENCES = ['high', 'medium', 'low'] as const;
const PARTIALS = [false, true] as const;

/** A refused row at a given crawl-health shape. Confidence/partial do not gate a refusal — the
 *  refusal payload does — so every one of these must reach the Stage 4 arc. */
const refusedRowAt = (confidence: string, partial: boolean) => ({
  ...REFUSED_ROW,
  confidence,
  partial,
  // The values that really travel with each band, so crawlHealth is not a constant wearing a label.
  coverage_pct: confidence === 'high' ? '1' : confidence === 'medium' ? '0.6' : '0.14',
  block_rate: confidence === 'low' ? '0.4' : '0',
});

/** The zero-page refusal: nothing was read at all. No pages, no links, no findings. */
const NOTHING_READ_ROW = {
  ...REFUSED_ROW,
  page_count: 0, link_count: 0, confidence: 'low', coverage_pct: '0', block_rate: '1', partial: true,
  refusal: { refused: true, triggers: ['nothing_read'], confidenceCapped: true, unevaluable: [] },
  coverage: { fetched: 0, gradeable: 0, excluded: [], sitemapDeclared: null, sitemapRobotsExcluded: null, estimatedTotal: 0, estimateSource: 'none', coverageRatio: 0 },
  discovered_count: 0, blocked_count: 0,
};

/** A running row carrying a real activity ring, so the route emits `activity` events. */
const ACTIVITY_LABEL = '/pages/activity-marker';
const RUNNING_WITH_ACTIVITY = {
  ...RUNNING_ROW,
  pages_crawled: 2, crawl_estimated_total: 10, crawl_phase: 'crawling',
  crawl_activity: [
    { seq: 1, kind: 'fetch_ok', label: ACTIVITY_LABEL, at: '2026-06-29T00:00:01Z', pagesFetched: 1 },
    { seq: 2, kind: 'sitemap_seeded', label: '/sitemap.xml', at: '2026-06-29T00:00:02Z' },
  ],
};
const CONV_NONE = { confidence_band: null, projected_score: null, projected_grade: null, previous_audit_id: null, completed_at: '2026-06-29T00:00:00Z', ai_readiness: null };
const CONV_GRADED = { ...CONV_NONE, projected_score: '88.00', projected_grade: 'A-' };

/** The slice of EventSource `wireAuditStream` uses. jsdom ships none, so this is a stand-in. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, ((e: Event) => void)[]>();
  closed = false;

  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, fn: (e: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close(): void { this.closed = true; }
  /** Deliver a payload EXACTLY as the route serialized it — no re-encoding. */
  emitRaw(type: string, data: string): void {
    const e = { data } as MessageEvent;
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  // jsdom implements no layout, so `scrollIntoView` is absent from its Element prototype (every real
  // browser has it). ActivityFeed calls it on mount. A gap in the environment, not a guard switched off.
  Element.prototype.scrollIntoView = () => {};
  auditRow = { ...REFUSED_ROW };
  convRow = { ...CONV_NONE };
  findingsThrow = false;
  emptyResults = false;
  pollRows = null;
  readCount = 0;
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function mount(auditId = 'aud-1') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<AuditView auditId={auditId} />); });
  const es = FakeEventSource.instances.at(-1);
  if (!es) throw new Error('AuditView did not open a stream');
  return { es, html: () => container!.innerHTML };
}

/** Mount, then replay the producer's emissions in order. Returns the rendered HTML. */
async function replay(seq: Emission[], auditId = 'aud-1') {
  const { es, html } = await mount(auditId);
  for (const { event, data } of seq) {
    await act(async () => es.emitRaw(event, data));
  }
  return { es, html };
}

describe('AuditView — replaying the real stream the route produces', () => {
  it('the producer emits `snapshot` BEFORE `done`, and only `done` carries the results', async () => {
    // This is the assumption every case below rests on, so it is asserted rather than assumed — and it
    // is the exact fact the length-one fixtures got wrong. If the route ever stops sending the leading
    // `snapshot`, this fails first and explains why the others changed.
    const seq = await captureFromRoute();
    expect(seq.map((s) => s.event)).toEqual(['snapshot', 'done']);
    const base = JSON.parse(seq[0]!.data);
    const done = JSON.parse(seq[1]!.data);
    expect(base.refusal?.refused).toBe(true);          // the decision is on the FIRST payload…
    expect(base.findings).toBeUndefined();             // …but the results are not
    expect(base.orphanCount).toBeUndefined();
    expect(Array.isArray(done.findings)).toBe(true);   // only the terminal payload completes it
    expect(done.orphanCount).not.toBeUndefined();
  }, 60_000);

  it('opens the audit stream for the id it was given', async () => {
    const { es } = await mount('aud-42');
    // Anti-vacuity for this whole file: if the component did not run, there is no instance to read.
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(es.url).toBe('/api/audits/aud-42/stream');
  });

  it('a REFUSED audit reaches the Stage 4 arc across the FULL sequence', async () => {
    // Kills gate 8's two survivors, because the second payload must REPLACE the first: `prev ?? payload`
    // and a `useMemo` keyed on `snapshot?.id` both retain the base payload, which has no results, so the
    // audit falls through to "Couldn't grade this site". Also kills gate 7's `refusal: null` and
    // `Pick`-narrowing prop evasions.
    const { html } = await replay(await captureFromRoute());
    expect(html()).toContain(NO_GRADE_LABEL);
    expect(html()).not.toContain(INVENTED_CAUSE);
    expect(html()).not.toContain('contact support');
    expect(html()).not.toContain(COULD_NOT_GRADE);
  }, 60_000);

  // ── THE ROW-SHAPE MATRIX (gate 9 / NB-1) ──────────────────────────────────
  // Every confidence band × partial flag, each captured from the route and replayed. A refusal is
  // decided by the refusal payload, never by crawl-health, so ALL SIX must reach the Stage 4 arc.
  // This is what makes an edit conditioned on a crawl-health field visible without anyone having had
  // to guess that field: `crawlHealth: confidence === 'low' ? null : crawlHealth` survived the
  // singleton fixture and dies here on 2 of the 6 shapes.
  for (const confidence of CONFIDENCES) {
    for (const partial of PARTIALS) {
      it(`refused at confidence=${confidence} partial=${partial} still renders the Stage 4 arc`, async () => {
        auditRow = refusedRowAt(confidence, partial);
        const seq = await captureFromRoute();
        // The shape really did reach the wire — otherwise this asserts nothing about that shape.
        const done = JSON.parse(seq[seq.length - 1]!.data);
        expect(done.crawlHealth?.confidence, 'the row shape did not survive to the payload').toBe(confidence);
        expect(done.crawlHealth?.partial).toBe(partial);

        const { html } = await replay(seq);
        expect(html()).toContain(NO_GRADE_LABEL);
        expect(html()).not.toContain(INVENTED_CAUSE);
        expect(html()).not.toContain(COULD_NOT_GRADE);
      }, 60_000);
    }
  }

  it('a ZERO-PAGE `nothing_read` refusal renders the arc — no pages, no links, no findings', async () => {
    // The other end of the shape space: the singleton had 2 pages, 1 link, 1 finding and 1 fix. This
    // row has none of them, so anything that quietly depends on a non-empty result set shows up here.
    auditRow = { ...NOTHING_READ_ROW };
    emptyResults = true;
    const seq = await captureFromRoute();
    const done = JSON.parse(seq[seq.length - 1]!.data);
    expect(done.findings).toEqual([]);
    expect(done.orphanCount).toBe(0);

    const { html } = await replay(seq);
    expect(html()).toContain(NO_GRADE_LABEL);
    expect(html()).not.toContain(INVENTED_CAUSE);
    expect(html()).not.toContain(COULD_NOT_GRADE);
  }, 60_000);

  it('the live ACTIVITY feed renders events the route emitted — `onActivity` is load-bearing', async () => {
    // GATE 9 / NB-4. No stub row carried `crawl_activity`, so the producer emitted no `activity`
    // events and deleting `onActivity` from the wireAuditStream call was invisible — leaving the live
    // feed (SPEC 04 §2, the "wow" beat) and the `activity_feed_first_event` funnel signal unprotected
    // at their only wiring site. This row carries a real ring, so the event is produced and rendered.
    // Terminates on the second read, so the route closes instead of polling to self-close.
    pollRows = [{ ...RUNNING_WITH_ACTIVITY }, { ...REFUSED_ROW }];
    const seq = await captureFromRoute();
    expect(seq.map((s) => s.event), 'the route emitted no activity event').toContain('activity');

    // Measured order: ["snapshot","activity","progress","done"]. Replay the RUNNING window — up to the
    // first `progress`, which is the tick reporting the crawl finished. The feed only exists while the
    // crawl runs, and that window is exactly what `onActivity` serves.
    const running = seq.slice(0, seq.findIndex((e) => e.event === 'progress'));
    expect(running.map((e) => e.event)).toEqual(['snapshot', 'activity']);
    const { html } = await replay(running);
    expect(html(), 'the activity feed rendered no event').toContain(ACTIVITY_LABEL);
    expect(html()).not.toContain('Waiting for the first pages');
  }, 60_000);

  it('a GRADED v2 audit reaches the v2 arc, not the legacy card', async () => {
    // Kills the `crawlHealth: null` prop evasion: `asClientAuditV2` keys only on crawlHealth, so
    // nulling it silently demotes every v2 audit to the pre-integration GradeCard — no gap, no cure.
    auditRow = { ...GRADED_ROW };
    convRow = { ...CONV_GRADED };
    const { html } = await replay(await captureFromRoute());
    expect(html()).toContain(V2_ARC_MARKER);
    expect(html()).toContain('64');
    expect(html()).not.toContain(INVENTED_CAUSE);
  }, 60_000);

  it('a v1 audit (no crawl-health) renders the legacy card — the same hop, from the other side', async () => {
    auditRow = { ...GRADED_ROW, confidence: null, coverage_pct: null, block_rate: null, partial: null };
    convRow = null;
    const seq = await captureFromRoute();
    expect(JSON.parse(seq[1]!.data).crawlHealth).toBeNull(); // v1 by construction, from the producer
    const { html } = await replay(seq);
    expect(html()).toContain('64');
    expect(html()).not.toContain(V2_ARC_MARKER);            // no v2 arc without crawl-health
    expect(html()).not.toContain(INVENTED_CAUSE);
  }, 60_000);

  it('a REFUSED audit whose results read THREW degrades to the card, and does not crash', async () => {
    // GATE 7 / B4, end to end and now producer-driven: buildDone throws, the route sends a named
    // `error`, and the newest snapshot is the base payload — refusal attached, `findings` absent.
    // Rendering that as a result threw "Cannot read properties of undefined (reading 'filter')".
    findingsThrow = true;
    const seq = await captureFromRoute();
    expect(seq.map((s) => s.event)).toEqual(['snapshot', 'error']); // the producer really does this
    const { html, es } = await replay(seq);
    expect(html()).toContain(COULD_NOT_GRADE);
    expect(html()).not.toContain(NO_GRADE_LABEL);
    expect(es.closed).toBe(true);
  }, 60_000);

  it('a live crawl emits snapshot → progress → done, and no verdict appears before `done`', async () => {
    // The three-event sequence from the poll loop rather than the short-circuit. Replayed one prefix
    // at a time, because each prefix is a state a real viewer sits in:
    //   snapshot          — crawl running        → progress UI
    //   + progress        — completed, no results yet → the skeleton (this is the "flash" window)
    //   + done            — results present      → the verdict
    // The middle prefix is the one that must NOT show a 0/0 card or a failure card.
    pollRows = [{ ...RUNNING_ROW }, { ...REFUSED_ROW }];
    const seq = await captureFromRoute();
    expect(seq.map((s) => s.event)).toEqual(['snapshot', 'progress', 'done']);
    expect(JSON.parse(seq[1]!.data).orphanCount).toBeUndefined(); // progress carries no results

    const running = await replay(seq.slice(0, 1));
    expect(running.html()).toContain('Cancel audit');
    expect(running.html()).not.toContain(NO_GRADE_LABEL);
    await act(async () => root!.unmount());
    root = null;

    const awaiting = await replay(seq.slice(0, 2));
    // POSITIVE assertion, gate 9 / NB-2. Negative assertions alone let `snapshot={done ? snapshot : null}`
    // survive: with the snapshot withheld until `done`, this window renders the live-crawl UI — a
    // "Cancel audit" button on an audit that has already finished — and nothing noticed. Name the
    // screen that must be here.
    expect(awaiting.html(), 'the completed-but-pre-done window is not the skeleton').toContain('Computing your grade');
    expect(awaiting.html()).not.toContain('Cancel audit');
    expect(awaiting.html()).not.toContain(NO_GRADE_LABEL);
    expect(awaiting.html()).not.toContain(INVENTED_CAUSE);
    expect(awaiting.html()).not.toContain(COULD_NOT_GRADE);
  }, 60_000);

  it('…and replaying that same sequence to completion lands on the Stage 4 arc', async () => {
    pollRows = [{ ...RUNNING_ROW }, { ...REFUSED_ROW }];
    const { html } = await replay(await captureFromRoute());
    expect(html()).toContain(NO_GRADE_LABEL);
    expect(html()).not.toContain(COULD_NOT_GRADE);
    expect(html()).not.toContain('Cancel audit');
  }, 60_000);

  it('a NATIVE transport error is ignored — the crawl keeps streaming', async () => {
    // HAND-BUILT ON PURPOSE, and the only one here that is. A data-less `error` is emitted by the
    // BROWSER when the connection drops, never by the route, so there is no producer to capture it
    // from. Treating it as terminal would abort a recoverable crawl.
    pollRows = [{ ...RUNNING_ROW }, { ...REFUSED_ROW }];
    const seq = await captureFromRoute();
    const { es, html } = await replay(seq.slice(0, 1));
    await act(async () => es.emitRaw('error', ''));
    expect(es.closed).toBe(false);
    expect(html()).toContain('Cancel audit');
  }, 60_000);

  it('a soft navigation A → B opens a new stream and shows none of A’s result', async () => {
    // The per-audit reset lives ONLY in this component. Without it B renders A's result until B's
    // first event lands — a real verdict on the primary screen, attributed to the wrong site.
    auditRow = { ...GRADED_ROW };
    convRow = { ...CONV_GRADED };
    const seq = await captureFromRoute();
    const { es: esA, html } = await replay(seq, 'aud-A');
    expect(html()).toContain(V2_ARC_MARKER);

    await act(async () => { root!.render(<AuditView auditId="aud-B" />); });
    const esB = FakeEventSource.instances.at(-1)!;
    expect(esB.url).toBe('/api/audits/aud-B/stream');
    expect(esA.closed).toBe(true);
    expect(html()).not.toContain(V2_ARC_MARKER);
    expect(html()).not.toContain('64');

    // …AND B STARTS FROM NOTHING, not from A's snapshot with the `done` flag cleared. Asserting only
    // the absence of A's letter is too weak: `setDone(false)` alone already hides it, so deleting
    // `setSnapshot(null)` from the reset survived (gate 8 / R3-N5). Keeping A's COMPLETED snapshot
    // makes `deriveAuditViewState` read `completed && !done` → the awaiting SKELETON, so a viewer
    // opening a running audit B sees a grade-card placeholder instead of the live crawl. B's own
    // state is `pending` → the progress UI, which is what a fresh audit must render.
    expect(html(), 'B rendered a state derived from A’s snapshot').toContain('Cancel audit');
  }, 60_000);
});
