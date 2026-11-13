/**
 * The render step of one check: pick the pages, render each twice (static side, then rendered side),
 * measure, and estimate the site. A page that is not rendered carries the reason and the check goes on:
 * a client that throws is read as `network_error`, and a word count that throws as `measure_failed`.
 * Nothing is written to disk.
 *
 * TWO PHASES. The graded phase renders `selectRenders`' picks (sample.ts). Once it has settled, the
 * empty-root phase renders `selectEmptyRoots`' picks (empty-root.ts), less any URL the graded phase
 * took. Each phase runs the COST rules below on its own: its own reservation from today's budget, its
 * own allowance, its own stop and its own settle. The graded phase's allowance is the check's cap or
 * what its pages could reserve, whichever is less; the empty-root phase's is what the cap leaves after
 * the graded phase counted, or what its own pages could reserve, whichever is less. When today's
 * budget refused the graded phase or threw, the empty-root phase does not ask it, and each of its
 * pages carries the graded phase's reason. A throw out of an empty-root page leaves every page of that
 * phase `phase_threw` once the phase has settled, and the check goes on. So the graded phase's pages,
 * and the estimate drawn from them alone, are what they would be with no empty-root phase; the
 * empty-root phase adds its wall time after them, and its browser time to `browser_ms`.
 *
 * COST. Today's budget is asked once per phase, before any of its pages, to reserve the phase's
 * allowance. When it refuses or throws, no page of the phase renders and each carries the reason.
 * When it grants, the pages reserve their two renders from that allowance, here and not from the
 * budget: a page that finds no room waits while another page of the phase is in flight, and when none
 * is, rendering stops for the rest of the phase. A render counts the browser time Browser Run reports
 * for it, or, when that is not known, the request timeout, which is also its reservation. A render can
 * report more than its reservation, so a phase can end above its allowance by that excess on the pages
 * in flight. After the phase's last page, the budget is settled once, at what the phase counted. Which
 * pages a binding cap leaves unrendered depends on how long the earlier renders took. A throw out of a
 * graded page is passed on after its phase settled, and the empty-root phase does not run.
 *
 * RATE LIMITS. At most `inFlight` requests are open at once (RENDER_MAX_IN_FLIGHT in the environment,
 * read by inFlightFromEnv). A 429 is retried no sooner than its Retry-After asks, in seconds or as a
 * date, or with exponential backoff when it gives neither, up to RENDER_RETRY.attempts tries; a page
 * asked to wait longer than RENDER_RETRY.max_ms is left `rate_limited` without retrying sooner.
 */
import { defaultAdmit, NotAdmitted, type Admit } from './admission.js';
import { usableCap, type DailyBudget, type RenderCaps } from './budget.js';
import {
  MAX_REPLY_BYTES,
  REQUEST_TIMEOUT_MS,
  type BrowserRunClient,
  type RenderReply,
  type RenderSide,
} from './client.js';
import { siteEstimate, type SiteEstimate } from './estimate.js';
import { measurePage, type WithoutJs } from './page.js';
import { selectEmptyRoots, type EmptyRootCandidate } from './empty-root.js';
import { oncePerUrl, selectRenders, type PickedFor, type RenderCandidate } from './sample.js';
import type { JsTextState } from './state.js';

/** The environment variable that sets how many requests one check keeps open at once. */
export const IN_FLIGHT_ENV = 'RENDER_MAX_IN_FLIGHT';
/** Requests open at once in one check when the environment does not set a valid number. */
export const RENDER_IN_FLIGHT_DEFAULT = 2;
/** The most the environment may set; our choice. */
export const RENDER_IN_FLIGHT_MAX = 10;
/** A whole number from 1 to RENDER_IN_FLIGHT_MAX, or RENDER_IN_FLIGHT_DEFAULT. */
const validInFlight = (n: number): number =>
  Number.isInteger(n) && n >= 1 && n <= RENDER_IN_FLIGHT_MAX ? n : RENDER_IN_FLIGHT_DEFAULT;
/** RENDER_MAX_IN_FLIGHT as digits from 1 to RENDER_IN_FLIGHT_MAX; anything else is the default. */
export function inFlightFromEnv(env: Record<string, string | undefined>): number {
  const v = env[IN_FLIGHT_ENV]?.trim() ?? '';
  return /^[0-9]+$/.test(v) ? validInFlight(Number(v)) : RENDER_IN_FLIGHT_DEFAULT;
}
export const RENDER_RETRY = { attempts: 5, base_ms: 2000, max_ms: 60_000 } as const;
/**
 * What one render reserves from its phase's allowance before it runs: the request timeout, which is also
 * what a render of unknown browser time is counted at, so such a render never counts above it.
 */
export const RESERVE_PER_RENDER_MS = REQUEST_TIMEOUT_MS;

/** Why a picked page has no `without_js`, and what each reason means (the spec renders this). */
export const NOT_RENDERED = {
  not_configured: 'The environment holds no Browser Run account or token.',
  caps_not_configured: 'A cost cap is not a positive whole number of seconds, so nothing renders.',
  not_admitted:
    'Admission refused the URL. `detail` is the policy rule, `resolution`, `unparseable`, or `error` for an admission that threw something else.',
  check_cap:
    "The phase's allowance could not take a page's two renders with no page of the phase in flight; rendering stopped for this page and the phase's pages after it.",
  daily_cap:
    "Today's budget refused the phase's allowance, asked for once before any of its pages; no page of the phase rendered.",
  daily_budget_unavailable:
    "Today's budget threw when asked for the phase's allowance; no page of the phase rendered.",
  rate_limited: `Browser Run answered 429 on each of ${RENDER_RETRY.attempts} tries, or its Retry-After asked for a wait longer than ${RENDER_RETRY.max_ms} ms.`,
  timed_out: `Browser Run did not answer, or did not finish its reply, within ${REQUEST_TIMEOUT_MS / 1000} s.`,
  page_failed:
    'Browser Run answered 422, which its documentation gives for a page that timed out, crashed or errored.',
  api_error: 'Browser Run answered another error status.',
  bad_reply: 'The reply was not the documented `{success: true, result: "<html>"}`.',
  oversize: `The reply passed ${MAX_REPLY_BYTES / 1024 / 1024} MiB and was not read further.`,
  network_error:
    'The request failed or its reply could not be read, for a reason other than the timeout, or the client threw.',
  challenged: 'A side of the render matches a challenge title or marker listed in challenge.ts.',
  nothing_rendered: 'The rendered side has no words, so there is no share.',
  measure_failed: 'Counting the words of the two renders threw.',
  phase_threw:
    "A page of the empty-root phase threw out of the render; each page of that phase is left unrendered, and the graded phase's pages stand.",
} as const;

export type NotRenderedReason = keyof typeof NOT_RENDERED;

interface Picked {
  url: string;
  template_key: string;
  /** `empty_root` for a page of the empty-root phase (empty-root.ts). */
  picked_for: PickedFor | 'empty_root';
}

export type RenderedPage =
  | (Picked & { rendered: true; without_js: WithoutJs })
  | (Picked & { rendered: false; reason: NotRenderedReason; detail?: string });

export interface RenderOutcome {
  /** The graded phase's pages, then the empty-root phase's, each in the order they were picked. */
  pages: RenderedPage[];
  /**
   * Browser time counted against this check's caps, both sides of each rendered page of both phases:
   * what Browser Run reported, or the request timeout where that is not known.
   */
  browser_ms: number;
  estimate: SiteEstimate;
  /**
   * True when today's budget threw on a phase's closing settle. The day may then still count that
   * phase's whole allowance, which is at least what the phase used unless a render reported more than
   * its reservation; CC-20 decides how the store is corrected.
   */
  settle_failed: boolean;
}

export interface RenderCheckInput {
  candidates: readonly RenderCandidate[];
  /** Template keys of the site's open client-rendered fixes. */
  openFixTemplates: readonly string[];
  maxRenders: number;
  /** Every crawled page, for the empty-root phase (empty-root.ts); none when left out. */
  emptyRootCandidates?: readonly EmptyRootCandidate[];
  /** The most pages the empty-root phase renders; 0 when left out. */
  maxEmptyRootRenders?: number;
  /** Each page's state in the previous check, where it was measured there. */
  previousStates: ReadonlyMap<string, JsTextState>;
  /** Null when the environment holds no Browser Run credentials. */
  client: BrowserRunClient | null;
  admit?: Admit;
  caps: RenderCaps;
  daily: DailyBudget;
  /** Requests open at once; from inFlightFromEnv. An invalid number is read as the default. */
  inFlight?: number;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const graded = (p: RenderCandidate) => p.kind === 'content' && p.status_code === 200 && p.is_html;

/** What one page reserves from its phase's allowance before it runs: both of its renders. */
const PAGE_RESERVE_MS = 2 * RESERVE_PER_RENDER_MS;

export async function renderCheck(input: RenderCheckInput): Promise<RenderOutcome> {
  const sample = selectRenders(input.candidates, input.openFixTemplates, input.maxRenders);
  const inSample = new Set(sample.map((p) => p.url));
  // A URL the graded sample took is not rendered again.
  const emptyRoots = selectEmptyRoots(
    input.emptyRootCandidates ?? [],
    input.maxEmptyRootRenders ?? 0,
  ).filter((p) => !inSample.has(p.url));
  const run = { ...input, admit: input.admit ?? defaultAdmit(), sleep: input.sleep ?? wait };

  const gradedPhase = await renderPhase(run, sample, (n) =>
    Math.min(input.caps.perCheckMs, n * PAGE_RESERVE_MS),
  );
  if (gradedPhase.thrown) throw gradedPhase.thrown.reason;
  // The empty-root phase starts once the graded phase has settled, under its own allowance: what the
  // check's cap leaves after the graded phase, or what its own pages could reserve, whichever is less.
  // When today's budget refused the graded phase, or could not be read, it is not asked again.
  const emptyRootPhase = await renderPhase(
    run,
    emptyRoots,
    (n) => Math.min(input.caps.perCheckMs - gradedPhase.browserMs, n * PAGE_RESERVE_MS),
    gradedPhase.stoppedAtBudget,
  );
  // A throw in the empty-root phase leaves that phase's pages unrendered; the graded phase stands.
  const emptyRootResults = emptyRootPhase.thrown
    ? emptyRoots.map((p): RenderedPage => ({ ...p, rendered: false, reason: 'phase_threw' }))
    : emptyRootPhase.results;

  const shares = new Map(
    gradedPhase.results.flatMap((r) =>
      r.rendered ? [[r.url, r.without_js.text_share] as const] : [],
    ),
  );
  const estimate = siteEstimate(
    oncePerUrl(input.candidates.filter(graded)).map((c) => ({
      template_key: c.template_key,
      text_share: shares.get(c.url) ?? null,
    })),
  );
  return {
    pages: [...gradedPhase.results, ...emptyRootResults],
    browser_ms: gradedPhase.browserMs + emptyRootPhase.browserMs,
    estimate,
    settle_failed: gradedPhase.settleFailed || emptyRootPhase.settleFailed,
  };
}

interface PhaseResult {
  /** The phase's pages, in the order they were picked. */
  results: RenderedPage[];
  browserMs: number;
  settleFailed: boolean;
  /** The first worker that threw, after the phase settled. */
  thrown: PromiseRejectedResult | undefined;
  /** `daily_cap` or `daily_budget_unavailable` when today's budget was asked and did not grant. */
  stoppedAtBudget: NotRenderedReason | null;
}

/**
 * One phase of a check's render: its own reservation from today's budget, its own allowance, its own
 * stop, and its own settle. Nothing a phase does reaches the pages of another.
 */
async function renderPhase(
  input: RenderCheckInput & { admit: Admit; sleep: (ms: number) => Promise<void> },
  sample: readonly Picked[],
  allowanceFor: (pages: number) => number,
  /** A reason the phase renders nothing, decided before it: today's budget is then not asked. */
  stoppedBefore: NotRenderedReason | null = null,
): Promise<PhaseResult> {
  const { admit, sleep } = input;
  let browserMs = 0;
  let checkHeld = 0;
  let stopped: NotRenderedReason | null =
    input.client === null
      ? 'not_configured'
      : !usableCap(input.caps.perCheckMs) || !usableCap(input.caps.perDayMs)
        ? 'caps_not_configured'
        : stoppedBefore;

  const notRendered = (p: Picked, reason: NotRenderedReason, detail?: string): RenderedPage =>
    detail === undefined
      ? { ...p, rendered: false, reason }
      : { ...p, rendered: false, reason, detail };

  /** One side of a page, retried on 429. Every reply's browser time is added to the page's `used`. */
  async function side(url: string, s: RenderSide, used: { ms: number }) {
    for (let attempt = 0; ; attempt += 1) {
      let reply: RenderReply;
      try {
        reply = await input.client!.content(url, s);
      } catch {
        reply = {
          ok: false,
          reason: 'network_error',
          retryAfterMs: null,
          browserMs: REQUEST_TIMEOUT_MS,
        };
      }
      used.ms += reply.browserMs;
      if (reply.ok || reply.reason !== 'rate_limited' || attempt + 1 >= RENDER_RETRY.attempts) {
        return reply;
      }
      const waitMs =
        reply.retryAfterMs ?? Math.min(RENDER_RETRY.base_ms * 2 ** attempt, RENDER_RETRY.max_ms);
      if (waitMs > RENDER_RETRY.max_ms) return reply;
      await sleep(waitMs);
    }
  }

  /**
   * The check's own reservations, kept here: what the pages in flight hold and what settled pages used,
   * against the allowance reserved from today's budget. Nothing in this loop awaits between the test
   * for room and the wait for it, so a page that settles cannot be missed by one about to wait.
   */
  let rendering = 0;
  const forRoom: (() => void)[] = [];
  const untilRoom = () => new Promise<void>((resolve) => forRoom.push(resolve));

  async function reserve(allowanceMs: number): Promise<NotRenderedReason | null> {
    for (;;) {
      if (stopped) return stopped;
      if (checkHeld + PAGE_RESERVE_MS <= allowanceMs) {
        checkHeld += PAGE_RESERVE_MS;
        rendering += 1;
        return null;
      }
      if (rendering === 0) return (stopped = 'check_cap');
      await untilRoom();
    }
  }

  async function renderPage(p: Picked, allowanceMs: number): Promise<RenderedPage> {
    if (stopped) return notRendered(p, stopped);
    try {
      await admit(p.url);
    } catch (e) {
      return notRendered(p, 'not_admitted', e instanceof NotAdmitted ? e.rule : 'error');
    }
    const refused = await reserve(allowanceMs);
    if (refused) return notRendered(p, refused);

    const used = { ms: 0 };
    try {
      return await renderReserved(p, used);
    } finally {
      browserMs += used.ms;
      checkHeld += used.ms - PAGE_RESERVE_MS;
      rendering -= 1;
      forRoom.splice(0).forEach((resolve) => resolve());
    }
  }

  async function renderReserved(p: Picked, used: { ms: number }): Promise<RenderedPage> {
    const staticSide = await side(p.url, 'static', used);
    if (!staticSide.ok) return notRendered(p, staticSide.reason);
    const renderedSide = await side(p.url, 'rendered', used);
    if (!renderedSide.ok) return notRendered(p, renderedSide.reason);
    let m: ReturnType<typeof measurePage>;
    try {
      m = measurePage({
        staticHtml: staticSide.html,
        renderedHtml: renderedSide.html,
        previous: input.previousStates.get(p.url) ?? null,
      });
    } catch {
      return notRendered(p, 'measure_failed');
    }
    return m.measured
      ? { ...p, rendered: true, without_js: m.without_js }
      : notRendered(p, m.reason);
  }

  /**
   * Today's budget is asked once a phase, before any of its pages: for the phase's whole allowance.
   * Refused, or unreadable, no page of the phase renders. Granted, it is settled once, at the browser
   * time the phase counted, after every page of the phase has finished.
   */
  const allowanceMs = allowanceFor(sample.length);
  let settleFailed = false;
  if (!stopped && sample.length > 0 && allowanceMs < PAGE_RESERVE_MS) stopped = 'check_cap';
  let reserved = false;
  let stoppedAtBudget: NotRenderedReason | null = null;
  if (!stopped && sample.length > 0) {
    try {
      reserved = (await input.daily.reserve(allowanceMs, input.caps.perDayMs)) === true;
      if (!reserved) stopped = stoppedAtBudget = 'daily_cap';
    } catch {
      stopped = stoppedAtBudget = 'daily_budget_unavailable';
    }
  }

  const results: RenderedPage[] = new Array(sample.length);
  let next = 0;
  const worker = async () => {
    while (next < sample.length) {
      const i = next++;
      results[i] = await renderPage(sample[i]!, allowanceMs);
    }
  };
  // Every worker is waited for, even after one throws, so no request is still open when the budget
  // is settled; a throw is passed on only after the settle. The other workers go on taking pages from
  // the queue until it is empty, and the results of the check are then discarded with the throw.
  const ran = await Promise.allSettled(
    Array.from(
      {
        length: Math.min(validInFlight(input.inFlight ?? RENDER_IN_FLIGHT_DEFAULT), sample.length),
      },
      worker,
    ),
  );

  if (reserved) {
    try {
      await input.daily.settle(allowanceMs, browserMs);
    } catch {
      settleFailed = true;
    }
  }
  const thrown = ran.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  return { results, browserMs, settleFailed, thrown, stoppedAtBudget };
}
