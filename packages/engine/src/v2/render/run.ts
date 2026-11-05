/**
 * The render step of one check: pick the pages, render each twice (static side, then rendered side),
 * measure, and estimate the site. A page that is not rendered carries the reason and the check goes on:
 * a client that throws is read as `network_error`, and a word count that throws as `measure_failed`.
 * Nothing is written to disk.
 *
 * COST. Today's budget is asked once per check, before any page, to reserve the check's allowance: its
 * cap, or RESERVE_PER_RENDER_MS for each render of each sampled page, whichever is less. When it
 * refuses or throws, no page renders and every sampled page carries the reason. When it grants, the
 * pages reserve their two renders from that allowance, here and not from the budget: a page that
 * finds no room waits while another page of the check is in flight, and when none is, rendering stops
 * for the rest of the check. A render counts the browser time Browser Run reports for it, or, when that
 * is not known, the request timeout, which is also its reservation. A render can report more than its
 * reservation, so a check can end above its allowance by that excess on the pages in flight. After
 * the last page, the budget is settled once, at what the check counted. Which pages a binding cap
 * leaves unrendered depends on how long the earlier renders took.
 *
 * RATE LIMITS. At most RENDER_IN_FLIGHT requests are open at once. A 429 is retried after the wait it
 * asks for in seconds, or with exponential backoff when it gives none, up to RENDER_RETRY.attempts
 * tries; a wait longer than RENDER_RETRY.max_ms is not taken. A page still refused is `rate_limited`.
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
import { oncePerUrl, selectRenders, type PickedFor, type RenderCandidate } from './sample.js';
import type { JsTextState } from './state.js';

export const RENDER_IN_FLIGHT = 5;
export const RENDER_RETRY = { attempts: 5, base_ms: 1000, max_ms: 16_000 } as const;
/**
 * What one render reserves from the check's allowance before it runs: the request timeout, which is also
 * what a render of unknown browser time is counted at, so such a render never counts above it.
 */
export const RESERVE_PER_RENDER_MS = REQUEST_TIMEOUT_MS;

/** Why a sampled page has no `without_js`, and what each reason means (the spec renders this). */
export const NOT_RENDERED = {
  not_configured: 'The environment holds no Browser Run account or token.',
  caps_not_configured: 'A cost cap is not a positive whole number of seconds, so nothing renders.',
  not_admitted:
    'Admission refused the URL. `detail` is the policy rule, `resolution`, `unparseable`, or `error` for an admission that threw something else.',
  check_cap:
    "The check's allowance could not take a page's two renders with no page in flight; rendering stopped for this page and those after it.",
  daily_cap:
    "Today's budget refused the check's allowance, asked for once before any page; no page of the check rendered.",
  daily_budget_unavailable:
    "Today's budget threw when asked for the check's allowance; no page of the check rendered.",
  rate_limited: `Browser Run answered 429 on each of ${RENDER_RETRY.attempts} tries, or asked for a wait longer than ${RENDER_RETRY.max_ms} ms.`,
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
} as const;

export type NotRenderedReason = keyof typeof NOT_RENDERED;

interface Picked {
  url: string;
  template_key: string;
  picked_for: PickedFor;
}

export type RenderedPage =
  | (Picked & { rendered: true; without_js: WithoutJs })
  | (Picked & { rendered: false; reason: NotRenderedReason; detail?: string });

export interface RenderOutcome {
  /** The sampled pages, in the order they were picked. */
  pages: RenderedPage[];
  /**
   * Browser time counted against this check's caps, both sides of each rendered page: what Browser Run
   * reported, or the request timeout where that is not known.
   */
  browser_ms: number;
  estimate: SiteEstimate;
  /**
   * True when today's budget threw on the closing settle. The day may then still count the whole
   * allowance, which is at least what the check used unless a render reported more than its
   * reservation; CC-20 decides how the store is corrected.
   */
  settle_failed: boolean;
}

export interface RenderCheckInput {
  candidates: readonly RenderCandidate[];
  /** Template keys of the site's open client-rendered fixes. */
  openFixTemplates: readonly string[];
  maxRenders: number;
  /** Each page's state in the previous check, where it was measured there. */
  previousStates: ReadonlyMap<string, JsTextState>;
  /** Null when the environment holds no Browser Run credentials. */
  client: BrowserRunClient | null;
  admit?: Admit;
  caps: RenderCaps;
  daily: DailyBudget;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const graded = (p: RenderCandidate) => p.kind === 'content' && p.status_code === 200 && p.is_html;

export async function renderCheck(input: RenderCheckInput): Promise<RenderOutcome> {
  const sample = selectRenders(input.candidates, input.openFixTemplates, input.maxRenders);
  const admit = input.admit ?? defaultAdmit();
  const sleep = input.sleep ?? wait;
  const pageReserve = 2 * RESERVE_PER_RENDER_MS;
  let browserMs = 0;
  let checkHeld = 0;
  let stopped: NotRenderedReason | null =
    input.client === null
      ? 'not_configured'
      : !usableCap(input.caps.perCheckMs) || !usableCap(input.caps.perDayMs)
        ? 'caps_not_configured'
        : null;

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
      if (checkHeld + pageReserve <= allowanceMs) {
        checkHeld += pageReserve;
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
      checkHeld += used.ms - pageReserve;
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
   * Today's budget is asked once, before any page: for the check's whole allowance, which is its cap or
   * what its sampled pages could reserve, whichever is less. Refused, or unreadable, nothing renders.
   * Granted, it is settled once, at the browser time the check counted, after every page has finished.
   */
  const allowanceMs = Math.min(input.caps.perCheckMs, sample.length * pageReserve);
  let settleFailed = false;
  if (!stopped && sample.length > 0 && allowanceMs < pageReserve) stopped = 'check_cap';
  let reserved = false;
  if (!stopped && sample.length > 0) {
    try {
      reserved = (await input.daily.reserve(allowanceMs, input.caps.perDayMs)) === true;
      if (!reserved) stopped = 'daily_cap';
    } catch {
      stopped = 'daily_budget_unavailable';
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
  await Promise.all(Array.from({ length: Math.min(RENDER_IN_FLIGHT, sample.length) }, worker));

  if (reserved) {
    try {
      await input.daily.settle(allowanceMs, browserMs);
    } catch {
      settleFailed = true;
    }
  }

  const shares = new Map(
    results.flatMap((r) => (r.rendered ? [[r.url, r.without_js.text_share] as const] : [])),
  );
  const estimate = siteEstimate(
    oncePerUrl(input.candidates.filter(graded)).map((c) => ({
      template_key: c.template_key,
      text_share: shares.get(c.url) ?? null,
    })),
  );
  return { pages: results, browser_ms: browserMs, estimate, settle_failed: settleFailed };
}
