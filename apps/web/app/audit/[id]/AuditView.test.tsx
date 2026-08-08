// @vitest-environment jsdom
//
// ─────────────────────────────────────────────────────────────────────────────
// THE FILE NO TEST LOADED.
//
// `AuditView.tsx` was imported by `page.tsx` and by NOTHING ELSE. An unconditional `throw` at its
// module scope left the whole web suite green — measured, not assumed — which means every claim any
// gate made about its contents was a claim about source text, never about behaviour. That is why
// three evasions survived gate 7 after the render decision had already been moved out of the JSX: the
// decision moved to executable code, and the last unexecuted thing left was the PROPS this component
// hands it. Fabricating a prop is invisible to a guard that reads the decision.
//
// So this file mounts it. `// @vitest-environment jsdom` is deliberately PER-FILE: 200+ existing
// `.tsx` tests render through `renderToStaticMarkup` under the node environment, and flipping the
// environment globally would put all of them on a different renderer to chase one file.
//
// WHAT ONLY THIS FILE CAN PROVE. `AuditSurfaceView.test.tsx` executes the whole decision chain from a
// snapshot; `audit-view-state.test.ts` executes the derivation. Neither can see the hop BEFORE them —
// EventSource → `setSnapshot` → the `snapshot`/`done`/`deps` props. That hop is what this covers, and
// it is the only place the three surviving evasions live.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
// The graph canvas is dynamically imported by LinkGraphSlot AFTER mount. Under jsdom that import
// would really pull in react-force-graph-2d and a canvas backend; the slot's own tests cover it.
vi.mock('@/components/audit/LinkGraph', () => ({ LinkGraph: () => null }));

import { AuditView } from './AuditView';
import { freeFixture, refusedFixture } from '@/components/audit/__fixtures__/client-audit-v2';
import { NO_GRADE_LABEL } from '@/lib/refusal-copy';

/** The pre-5.1 failure copy — the invented cause this spec exists to delete from a refusal. */
const INVENTED_CAUSE = 'usually a site that blocks crawlers';
/** Uniquely `ResultView`'s free-cure card: present on the v2 arc, absent from the legacy GradeCard. */
const V2_ARC_MARKER = 'see our pricing';

/**
 * The slice of EventSource `wireAuditStream` uses, plus an `emit` the test drives. jsdom has no
 * EventSource at all, so this is a stand-in rather than an override — nothing real is being masked.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, ((e: Event) => void)[]>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (e: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  close(): void {
    this.closed = true;
  }

  /** `data: undefined` models a NATIVE transport error (no payload) — the reconnectable kind. */
  emit(type: string, data?: unknown): void {
    const e = { data: data === undefined ? '' : JSON.stringify(data) } as MessageEvent;
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}

// ── The payloads the SSE route really sends ──────────────────────────────────
// `projectAuditForClient` emits the BASE ClientAudit on `snapshot`/`progress` and only the terminal
// `done` event carries findings/entitlement/orphanCount/avgDepth. Both shapes appear below, because
// the difference between them is the B4 crash.

const wire = <T extends object>(o: T) => ({ page_count: 48, link_count: 213, settings: { pageCap: 500 }, ...o });

/** A terminal `done` payload for a REFUSED audit: the decision is attached and the stats are present. */
const DONE_REFUSED = wire({ ...refusedFixture, status: 'completed' });
/** A terminal `done` payload for a GRADED v2 audit. */
const DONE_GRADED = wire({ ...freeFixture, status: 'completed' });

/** The BASE payload — what the client is still holding when `buildDone` throws and the route sends a
 *  named `error` instead of `done`. No findings, no entitlement, no orphanCount/avgDepth. */
const BASE_REFUSED = wire({
  id: refusedFixture.id,
  status: 'completed',
  grade: null,
  score: null,
  cms_detected: 'wordpress',
  failureCategory: null,
  crawlHealth: freeFixture.crawlHealth,
  refusal: { refused: true },
  coverage: refusedFixture.coverage,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  // jsdom implements no layout, so `scrollIntoView` is absent from its Element prototype (every real
  // browser has it). ActivityFeed calls it on mount. This is a gap in the environment, not a guard
  // being switched off — nothing about the audit surface is masked by it.
  Element.prototype.scrollIntoView = () => {};
});

afterEach(async () => {
  // Unmount so the 5s staleness interval cannot outlive the test.
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function mount(auditId = 'aud-1') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<AuditView auditId={auditId} />);
  });
  const es = FakeEventSource.instances.at(-1);
  if (!es) throw new Error('AuditView did not open a stream');
  return { es, html: () => container!.innerHTML };
}

/** Rerender the SAME root with a different audit id — a soft navigation /audit/A → /audit/B. */
async function renavigate(auditId: string) {
  await act(async () => {
    root!.render(<AuditView auditId={auditId} />);
  });
  return FakeEventSource.instances.at(-1)!;
}

describe('AuditView — the stream hop, executed', () => {
  it('opens the audit stream for the id it was given', async () => {
    const { es } = await mount('aud-42');
    // Anti-vacuity for this whole file: if the component did not run, there is no instance to read.
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(es.url).toBe('/api/audits/aud-42/stream');
  });

  it('a REFUSED done payload reaches the Stage 4 arc — never the failure card', async () => {
    // Gate 7 evasion 1: `snapshot={{ ...snapshot, refusal: null }}` — the decision is untouched and
    // correct; the refusal simply never arrives. Gate 7 evasion 3 (a `Pick` props object omitting
    // `refusal`) lands in the same place. Both route a withheld verdict to "Couldn't grade this site".
    const { es, html } = await mount();
    await act(async () => es.emit('done', DONE_REFUSED));

    expect(html()).toContain(NO_GRADE_LABEL);
    expect(html()).not.toContain(INVENTED_CAUSE);
    expect(html()).not.toContain('contact support');
    expect(html()).not.toContain('Couldn’t grade this site');
    expect(es.closed).toBe(true);
  });

  it('a GRADED v2 done payload reaches the v2 arc, not the legacy card', async () => {
    // Gate 7 evasion 2: `snapshot={{ ...snapshot, crawlHealth: null }}`. `asClientAuditV2` keys ONLY
    // on crawlHealth, so nulling it silently demotes every v2 audit to the pre-integration GradeCard
    // — no gap, no free cure, no conversion arc — with the suite green. The marker below is the free
    // cure's own anchor text, which exists on one arc and not the other.
    const { es, html } = await mount();
    await act(async () => es.emit('done', DONE_GRADED));

    expect(html()).toContain(V2_ARC_MARKER);
    expect(html()).toContain(String(freeFixture.score));
    expect(html()).not.toContain(INVENTED_CAUSE);
  });

  it('the same crawlHealth hop, from the refused side — a refusal with no v2 payload is the error card', async () => {
    // The pair matters: nulling crawlHealth on a REFUSED audit does not merely change the arc, it
    // sends the refusal to `decideAuditSurface`'s last-resort branch. Asserting both sides means the
    // evasion has nowhere to land where only one of them notices.
    const { es, html } = await mount();
    await act(async () => es.emit('done', { ...DONE_REFUSED, crawlHealth: null }));

    expect(html()).toContain('Couldn’t grade this site');
    expect(html()).not.toContain(NO_GRADE_LABEL);
  });

  it('a named stream `error` after a BASE refused payload degrades to the card, and does not crash', async () => {
    // GATE 7 / B4, end to end. `buildDone` threw, so the route sent a named `error`; `done` flips true
    // and the newest snapshot is the base ClientAudit — refusal attached, `findings` absent. Rendering
    // that as a result threw `Cannot read properties of undefined (reading 'filter')` on the primary
    // page. `hasResults` gates refused exactly as it gates graded, so it lands on the card instead.
    const { es, html } = await mount();
    await act(async () => es.emit('progress', BASE_REFUSED));
    await act(async () => es.emit('error', { message: 'finalization failed' }));

    expect(html()).toContain('Couldn’t grade this site');
    expect(html()).not.toContain(NO_GRADE_LABEL);
    expect(es.closed).toBe(true);
  });

  it('a NATIVE transport error is ignored — the crawl keeps streaming', async () => {
    // The other half of the same listener: no `data` means the browser dropped the connection and
    // EventSource will reconnect. Treating it as terminal would abort a running crawl.
    const { es, html } = await mount();
    await act(async () => es.emit('progress', wire({ id: 'a', status: 'running' })));
    await act(async () => es.emit('error'));

    expect(es.closed).toBe(false);
    expect(html()).toContain('Cancel audit');
  });

  it('renders progress — not a verdict — while the crawl runs', async () => {
    const { es, html } = await mount();
    await act(async () => es.emit('snapshot', wire({ id: 'a', status: 'running', grade: null, score: null, refusal: null })));

    expect(html()).toContain('Cancel audit');
    expect(html()).not.toContain(NO_GRADE_LABEL);
    expect(html()).not.toContain(INVENTED_CAUSE);
  });

  it('a soft navigation A → B opens a new stream and shows none of A’s result', async () => {
    // The per-audit reset effect lives ONLY in this component. Without it B renders A's grade until
    // B's first event lands — a wrong result on the primary screen, attributed to the wrong site.
    const { es: esA, html } = await mount('aud-A');
    await act(async () => esA.emit('done', DONE_GRADED));
    expect(html()).toContain(V2_ARC_MARKER);

    const esB = await renavigate('aud-B');
    expect(esB.url).toBe('/api/audits/aud-B/stream');
    expect(esA.closed).toBe(true);
    expect(html()).not.toContain(V2_ARC_MARKER);
    expect(html()).not.toContain(String(freeFixture.score));
  });
});
