/**
 * The render step of one check: pick the pages, render each twice (static side, then rendered side),
 * measure, and estimate the site. A page that is not rendered carries the reason and the check goes on:
 * a client that throws is read as `network_error`, and a word count that throws as `measure_failed`.
 * The day's reservation is settled whatever happens to the page. Nothing is written to disk.
 *
 * COST. Before a page starts, it reserves both of its renders at the wait cap, against the check's cap
 * and against today's budget. When either cannot take them while other pages of the check are in
 * flight, the page waits for one to settle and tries again; when nothing is in flight, rendering stops
 * for the rest of the check. A render settles at the browser time Browser Run reports for it. A render
 * can report more than the wait cap, so a check can end above its cap by that excess on the pages in
 * flight. Which pages a binding cap leaves unrendered depends on how long the earlier renders took.
 *
 * RATE LIMITS. At most RENDER_IN_FLIGHT requests are open at once. A 429 is retried after the wait it
 * asks for in seconds, or with exponential backoff when it gives none, up to RENDER_RETRY.attempts
 * tries; a wait longer than RENDER_RETRY.max_ms is not taken. A page still refused is `rate_limited`.
 */
import { defaultAdmit, NotAdmitted, type Admit } from './admission.js';
import { usableCap, type DailyBudget, type RenderCaps } from './budget.js';
import {
  MAX_REPLY_BYTES,
  RENDER_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  type BrowserRunClient,
  type RenderReply,
  type RenderSide,
} from './client.js';
import { siteEstimate, type SiteEstimate } from './estimate.js';
import { measurePage, type WithoutJs } from './page.js';
import { selectRenders, type PickedFor, type RenderCandidate } from './sample.js';
import type { JsTextState } from './state.js';

export const RENDER_IN_FLIGHT = 5;
export const RENDER_RETRY = { attempts: 5, base_ms: 1000, max_ms: 16_000 } as const;
/** What one render reserves before it runs: the wait cap. */
export const RESERVE_PER_RENDER_MS = RENDER_TIMEOUT_MS;

/** Why a sampled page has no `without_js`, and what each reason means (the spec renders this). */
export const NOT_RENDERED = {
  not_configured: 'The environment holds no Browser Run account or token.',
  caps_not_configured: 'A cost cap is not a positive whole number of seconds, so nothing renders.',
  not_admitted:
    'Admission refused the URL. `detail` is the policy rule, `resolution`, `unparseable`, or `error` for an admission that threw something else.',
  check_cap:
    "The check's cap could not take a page's two renders with no page in flight; rendering stopped for this page and those after it.",
  daily_cap:
    "Today's budget could not take a page's two renders with no page of this check in flight; rendering stopped for this page and those after it.",
  daily_budget_unavailable:
    "Today's budget threw when asked to reserve or settle; rendering stopped for this page and those after it.",
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
  /** Browser time spent by this check, both sides of every page, as Browser Run reported it. */
  browser_ms: number;
  estimate: SiteEstimate;
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
   * Pages asking today's budget for a reservation now, and pages rendering on one. A page that cannot
   * reserve waits in one of two queues: for room under the check's cap, which any page frees when it
   * is refused or settles; or for room in today's budget, which only a page that settles frees.
   */
  let asking = 0;
  let rendering = 0;
  const forCheckRoom: (() => void)[] = [];
  const forDayRoom: (() => void)[] = [];
  const until = (queue: (() => void)[]) => new Promise<void>((resolve) => queue.push(resolve));
  const wake = (queue: (() => void)[]) => queue.splice(0).forEach((resolve) => resolve());

  /**
   * Reserve a page's two renders against the check's cap and today's budget. When the check's cap
   * cannot take them while another page is asking or rendering, wait for room and try again. When
   * today's budget refuses them while another page is rendering, wait for that page to settle and try
   * again. When there is nothing to wait for, rendering stops for the rest of the check.
   */
  async function reserve(): Promise<NotRenderedReason | null> {
    for (;;) {
      if (stopped) return stopped;
      if (checkHeld + pageReserve > input.caps.perCheckMs) {
        if (asking + rendering === 0) return (stopped = 'check_cap');
        await until(forCheckRoom);
        continue;
      }
      checkHeld += pageReserve;
      asking += 1;
      let reserved: boolean;
      try {
        reserved = await input.daily.reserve(pageReserve, input.caps.perDayMs);
      } catch {
        stopped = 'daily_budget_unavailable';
        reserved = false;
      } finally {
        asking -= 1;
      }
      if (reserved) {
        rendering += 1;
        return null;
      }
      checkHeld -= pageReserve;
      wake(forCheckRoom);
      if (stopped) {
        wake(forDayRoom);
        return stopped;
      }
      if (rendering === 0) return (stopped = 'daily_cap');
      await until(forDayRoom);
    }
  }

  async function renderPage(p: Picked): Promise<RenderedPage> {
    if (stopped) return notRendered(p, stopped);
    try {
      await admit(p.url);
    } catch (e) {
      return notRendered(p, 'not_admitted', e instanceof NotAdmitted ? e.rule : 'error');
    }
    const refused = await reserve();
    if (refused) return notRendered(p, refused);

    const used = { ms: 0 };
    try {
      return await renderReserved(p, used);
    } finally {
      browserMs += used.ms;
      checkHeld += used.ms - pageReserve;
      try {
        await input.daily.settle(pageReserve, used.ms);
      } catch {
        stopped ??= 'daily_budget_unavailable';
      }
      rendering -= 1;
      wake(forCheckRoom);
      wake(forDayRoom);
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

  const results: RenderedPage[] = new Array(sample.length);
  let next = 0;
  const worker = async () => {
    while (next < sample.length) {
      const i = next++;
      results[i] = await renderPage(sample[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(RENDER_IN_FLIGHT, sample.length) }, worker));

  const shares = new Map(
    results.flatMap((r) => (r.rendered ? [[r.url, r.without_js.text_share] as const] : [])),
  );
  const estimate = siteEstimate(
    input.candidates
      .filter(graded)
      .map((c) => ({ template_key: c.template_key, text_share: shares.get(c.url) ?? null })),
  );
  return { pages: results, browser_ms: browserMs, estimate };
}
