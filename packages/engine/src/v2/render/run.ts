/**
 * The render step of one check: pick the pages, render each twice (static side, then rendered side),
 * measure, and estimate the site. It never throws for a page: a page that is not rendered carries the
 * reason, and the check goes on. Nothing is written to disk.
 *
 * COST. Before a page starts, it reserves both of its renders at the wait cap, against the check's cap
 * and against today's budget; when either cannot take them, rendering stops for the rest of the check.
 * A render then settles at the browser time Browser Run reports for it. A render can report more than
 * the wait cap, so a check can end above its cap by that excess on the pages in flight. Which pages a
 * binding cap leaves unrendered depends on how long the earlier renders took.
 *
 * RATE LIMITS. At most RENDER_IN_FLIGHT requests are open at once. A 429 is retried after the wait it
 * asks for, or with exponential backoff when it gives none, up to RENDER_RETRY.attempts tries; a page
 * still refused after that is `rate_limited`.
 */
import { defaultAdmit, NotAdmitted, type Admit } from './admission.js';
import type { DailyBudget, RenderCaps } from './budget.js';
import {
  MAX_REPLY_BYTES,
  RENDER_TIMEOUT_MS,
  type BrowserRunClient,
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
  caps_not_configured: 'A cost cap is unset, invalid or zero, so nothing renders.',
  not_admitted: 'Admission refused the URL; `detail` names the rule, or `resolution`.',
  check_cap: "The check's cap could not take this page's two renders; rendering stopped.",
  daily_cap: "Today's budget could not take this page's two renders; rendering stopped.",
  daily_budget_unavailable: "Today's budget could not be read or written; rendering stopped.",
  rate_limited: `Browser Run answered 429 on every try (${RENDER_RETRY.attempts}).`,
  page_failed: 'Browser Run answered 422: the page timed out, crashed or errored while loading.',
  api_error: 'Browser Run answered another error status.',
  bad_reply: 'The reply was not the documented `{success: true, result: "<html>"}`.',
  oversize: `The reply passed ${MAX_REPLY_BYTES / 1024 / 1024} MiB and was not read further.`,
  network_error: 'The request to Browser Run failed before an answer.',
  challenged: 'A side of the render is a challenge or block page (challenge.ts).',
  nothing_rendered: 'The rendered side has no words, so there is no share.',
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
      : input.caps.perCheckMs === 0 || input.caps.perDayMs === 0
        ? 'caps_not_configured'
        : null;

  const notRendered = (p: Picked, reason: NotRenderedReason, detail?: string): RenderedPage =>
    detail === undefined
      ? { ...p, rendered: false, reason }
      : { ...p, rendered: false, reason, detail };

  /** One side of a page, retried on 429. Every reply's browser time is added to the page's `used`. */
  async function side(url: string, s: RenderSide, used: { ms: number }) {
    for (let attempt = 0; ; attempt += 1) {
      const reply = await input.client!.content(url, s);
      used.ms += reply.browserMs;
      if (reply.ok || reply.reason !== 'rate_limited' || attempt + 1 >= RENDER_RETRY.attempts) {
        return reply;
      }
      await sleep(
        reply.retryAfterMs ?? Math.min(RENDER_RETRY.base_ms * 2 ** attempt, RENDER_RETRY.max_ms),
      );
    }
  }

  async function renderPage(p: Picked): Promise<RenderedPage> {
    if (stopped) return notRendered(p, stopped);
    try {
      await admit(p.url);
    } catch (e) {
      return notRendered(p, 'not_admitted', e instanceof NotAdmitted ? e.rule : 'error');
    }
    if (stopped) return notRendered(p, stopped);
    if (checkHeld + pageReserve > input.caps.perCheckMs)
      return notRendered(p, (stopped = 'check_cap'));
    checkHeld += pageReserve;
    let reserved: boolean;
    try {
      reserved = await input.daily.reserve(pageReserve);
    } catch {
      reserved = false;
      stopped = 'daily_budget_unavailable';
    }
    if (!reserved) {
      checkHeld -= pageReserve;
      return notRendered(p, (stopped ??= 'daily_cap'));
    }

    const used = { ms: 0 };
    let result: RenderedPage;
    const staticSide = await side(p.url, 'static', used);
    if (!staticSide.ok) {
      result = notRendered(p, staticSide.reason);
    } else {
      const renderedSide = await side(p.url, 'rendered', used);
      if (!renderedSide.ok) {
        result = notRendered(p, renderedSide.reason);
      } else {
        const m = measurePage({
          staticHtml: staticSide.html,
          renderedHtml: renderedSide.html,
          previous: input.previousStates.get(p.url) ?? null,
        });
        result = m.measured
          ? { ...p, rendered: true, without_js: m.without_js }
          : notRendered(p, m.reason);
      }
    }
    browserMs += used.ms;
    checkHeld += used.ms - pageReserve;
    try {
      await input.daily.settle(pageReserve, used.ms);
    } catch {
      stopped ??= 'daily_budget_unavailable';
    }
    return result;
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
