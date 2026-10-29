/**
 * The progress-event contract: what the audit pipeline streams while a check runs, and the state a
 * screen builds from it. The crawl-in-progress screen replays these events; a live pipeline will
 * emit the same shape.
 *
 * `reduce` is pure, so the state at any moment is a function of the events up to that moment, and
 * `toProgress` maps that state onto the contract's `Progress` snapshot (packages/types/src/v2/check.ts).
 */
import { z } from 'zod';
import {
  AiReadabilitySchema,
  CheckPhaseSchema,
  CountSchema,
  CrawlerGroupSchema,
  EvidenceClassSchema,
  FingerprintSchema,
  FixSectionSchema,
  HttpStatusSchema,
  HttpUrlSchema,
  ProgressSchema,
  TechnicalSeoSchema,
  VerdictSchema,
} from '@crawlmouse/types/v2';

export type CheckPhase = z.infer<typeof CheckPhaseSchema>;
export type Progress = z.infer<typeof ProgressSchema>;

const at_ms = CountSchema;

const Stage = z
  .strictObject({
    type: z.literal('stage'),
    at_ms,
    phase: CheckPhaseSchema,
    state: z.enum(['now', 'done']),
  })
  .describe("A step of the check starts (`now`) or finishes (`done`), in the contract's order.");

/** The engine's estimate of the site's size, from the sitemap and the homepage ("of about N"). */
const PagesEstimated = z
  .strictObject({
    type: z.literal('pages_estimated'),
    at_ms,
    pages: CountSchema,
  })
  .describe(
    'The engine\'s estimate of the site\'s size, from the sitemap and the homepage: the "about N".',
  );

/**
 * One request and its answer. `identity` is who we said we were: `browser` (an untagged browser
 * user agent), `render` (a full browser render), or a crawler's registry token. `purpose` is the
 * part of the method it belongs to: the structure `crawl` (which puts the page on the link map), a
 * crawler `test`, the untagged `control` beside each test, or the `render` that measures text
 * without JavaScript. `links` is the number of internal links in the response, repeats included.
 */
const PageFetched = z
  .strictObject({
    type: z.literal('page_fetched'),
    at_ms,
    url: HttpUrlSchema,
    identity: z.string().min(1),
    purpose: z.enum(['crawl', 'test', 'control', 'render']),
    status: HttpStatusSchema,
    ms: CountSchema,
    links: CountSchema,
  })
  .describe(
    'One request and its answer: who we said we were, why, the status, how long it took, and the internal links in the response.',
  );

/** The first link to `url` was found, on `from`. A JavaScript link is found by rendering `from`. */
const PageLinked = z
  .strictObject({
    type: z.literal('page_linked'),
    at_ms,
    url: HttpUrlSchema,
    from: HttpUrlSchema,
    via: z.enum(['link', 'javascript']),
  })
  .describe(
    'The first link to a page was found, on another page; a JavaScript link is found by rendering. Places the page on the map.',
  );

/** Known only once the crawl is complete: no link reaches the page, or only JavaScript does. */
const PageClassified = z
  .strictObject({
    type: z.literal('page_classified'),
    at_ms,
    url: HttpUrlSchema,
    as: z.enum(['orphan', 'js_only']),
  })
  .describe('Known once the crawl is complete: no link reaches the page, or only JavaScript does.');

/** The running totals. `links_found` counts distinct internal links, so it is not a sum of `links`. */
const Counts = z
  .strictObject({
    type: z.literal('counts'),
    at_ms,
    pages_crawled: CountSchema,
    links_found: CountSchema,
  })
  .describe('The running totals; `links_found` counts distinct internal links.');

const CrawlerVerdict = z
  .strictObject({
    type: z.literal('crawler_verdict'),
    at_ms,
    ua: z.string().min(1),
    group: CrawlerGroupSchema,
    scored: z.boolean(),
    verdict: VerdictSchema,
    evidence_class: EvidenceClassSchema,
    status: HttpStatusSchema.nullable(),
    pages_measured: CountSchema,
  })
  .describe("One crawler's verdict has landed, with the evidence it rests on.");

const Finding = z
  .strictObject({
    type: z.literal('finding'),
    at_ms,
    fingerprint: FingerprintSchema,
    title: z.string().min(1),
    section: FixSectionSchema,
    affected_pages: CountSchema,
  })
  .describe('A fix was detected, named as the fix list names it.');

const Graded = z
  .strictObject({
    type: z.literal('graded'),
    at_ms,
    technical_seo: TechnicalSeoSchema,
    ai_readability: AiReadabilitySchema,
  })
  .describe("Both grades, in the contract's shapes: the reveal.");

const Ended = z
  .strictObject({
    type: z.literal('ended'),
    at_ms,
    status: z.enum(['finished', 'partial', 'failed']),
  })
  .describe('The check is over; nothing follows.');

export const ProgressEventSchema = z.discriminatedUnion('type', [
  Stage,
  PagesEstimated,
  PageFetched,
  PageLinked,
  PageClassified,
  Counts,
  CrawlerVerdict,
  Finding,
  Graded,
  Ended,
]);

export type ProgressEvent = z.infer<typeof ProgressEventSchema>;
export type FetchEvent = z.infer<typeof PageFetched>;
export type VerdictEvent = z.infer<typeof CrawlerVerdict>;
export type FindingEvent = z.infer<typeof Finding>;
export type GradedEvent = z.infer<typeof Graded>;

export const PHASES: readonly CheckPhase[] = CheckPhaseSchema.options;

export type StepState = 'done' | 'now' | 'next';

/** A page on the link map: one per page fetched during the crawl. */
export interface MapNode {
  url: string;
  /** The page whose link reached this one first; null until one is found. */
  from: string | null;
  via: 'link' | 'javascript' | null;
  kind: 'page' | 'orphan' | 'js_only';
}

export interface CrawlState {
  elapsed_ms: number;
  /** The moment of the last event applied. */
  last_ms: number;
  steps: { phase: CheckPhase; state: StepState }[];
  pages_estimated: number | null;
  pages_crawled: number;
  links_found: number;
  /** In the order they were first fetched. */
  nodes: MapNode[];
  /** The first link found to each page, fetched or not yet, keyed by URL. */
  first_links: Record<string, { from: string; via: 'link' | 'javascript' }>;
  /** Every request, oldest first. */
  fetches: Omit<FetchEvent, 'type'>[];
  /** Keyed by registry token, in the order the verdicts landed. */
  verdicts: Record<string, Omit<VerdictEvent, 'type'>>;
  findings: Omit<FindingEvent, 'type'>[];
  grades: Omit<GradedEvent, 'type' | 'at_ms'> | null;
  ended: z.infer<typeof Ended>['status'] | null;
}

export const INITIAL_STATE: CrawlState = Object.freeze({
  elapsed_ms: 0,
  last_ms: 0,
  steps: PHASES.map((phase) => ({ phase, state: 'next' as const })),
  pages_estimated: null,
  pages_crawled: 0,
  links_found: 0,
  nodes: [],
  first_links: {},
  fetches: [],
  verdicts: {},
  findings: [],
  grades: null,
  ended: null,
}) as CrawlState;

function advanceStep(steps: CrawlState['steps'], phase: CheckPhase, to: 'now' | 'done') {
  const i = steps.findIndex((s) => s.phase === phase);
  const from = to === 'now' ? 'next' : 'now';
  const previousDone = steps.slice(0, i).every((s) => s.state === 'done');
  if (steps[i]?.state !== from || (to === 'now' && !previousDone)) {
    throw new Error(`Stage ${phase} cannot become ${to} from ${steps[i]?.state}`);
  }
  return steps.map((s, j) => (j === i ? { phase, state: to } : s));
}

function updateNode(nodes: MapNode[], url: string, change: Partial<MapNode>): MapNode[] {
  return nodes.map((n) => (n.url === url ? { ...n, ...change } : n));
}

function withoutType<E extends { type: string }>(event: E): Omit<E, 'type'> {
  const copy: Partial<E> = { ...event };
  delete copy.type;
  return copy as Omit<E, 'type'>;
}

/**
 * Applies one event. Throws, the stream being broken, on: an event earlier than the last; any event
 * after the end; a step out of the contract's order; counts that fall; a page linked from itself or
 * classified before it was fetched; a second verdict for a crawler or finding for a fingerprint;
 * grades twice, or before grading starts; a change to the map (a page added, first linked or
 * classified) once grading has begun; and an end, finished or partial, with a step not done.
 */
export function reduce(state: CrawlState, event: ProgressEvent): CrawlState {
  if (event.at_ms < state.last_ms) {
    throw new Error(`Event ${event.type} at ${event.at_ms} ms goes back in time`);
  }
  if (state.ended !== null) {
    throw new Error(`Event ${event.type} at ${event.at_ms} ms comes after the stream ended`);
  }
  const s: CrawlState = { ...state, last_ms: event.at_ms, elapsed_ms: event.at_ms };
  const next = apply(state, s, event);
  // The map has its last pages once grading begins (mapIsComplete): nothing may add to it or
  // reclassify it after, or a finished map would be laid out again.
  if (next.nodes !== state.nodes && mapIsComplete(state)) {
    throw new Error(`Event ${event.type} at ${event.at_ms} ms changes the map after grading began`);
  }
  return next;
}

function apply(state: CrawlState, s: CrawlState, event: ProgressEvent): CrawlState {
  switch (event.type) {
    case 'stage':
      return { ...s, steps: advanceStep(state.steps, event.phase, event.state) };
    case 'pages_estimated':
      return { ...s, pages_estimated: event.pages };
    case 'page_fetched': {
      const fetch = withoutType(event);
      const isNew = fetch.purpose === 'crawl' && !state.nodes.some((n) => n.url === fetch.url);
      const link = state.first_links[fetch.url];
      const node: MapNode = {
        url: fetch.url,
        from: link?.from ?? null,
        via: link?.via ?? null,
        kind: 'page',
      };
      return {
        ...s,
        fetches: [...state.fetches, fetch],
        nodes: isNew ? [...state.nodes, node] : state.nodes,
      };
    }
    case 'page_linked': {
      if (event.from === event.url) throw new Error(`${event.url} is linked from itself`);
      // Only the first link to a page places it on the map; later links change nothing.
      if (Object.hasOwn(state.first_links, event.url)) return s;
      const link = { from: event.from, via: event.via };
      return {
        ...s,
        first_links: { ...state.first_links, [event.url]: link },
        nodes: updateNode(state.nodes, event.url, link),
      };
    }
    case 'page_classified':
      if (!state.nodes.some((n) => n.url === event.url)) {
        throw new Error(`Classified ${event.url} before it was fetched`);
      }
      return { ...s, nodes: updateNode(state.nodes, event.url, { kind: event.as }) };
    case 'counts':
      if (event.pages_crawled < state.pages_crawled || event.links_found < state.links_found) {
        throw new Error(`Counts at ${event.at_ms} ms fall`);
      }
      return { ...s, pages_crawled: event.pages_crawled, links_found: event.links_found };
    case 'crawler_verdict': {
      if (Object.hasOwn(state.verdicts, event.ua)) {
        throw new Error(`A verdict for ${event.ua} landed twice, at ${event.at_ms} ms`);
      }
      return { ...s, verdicts: { ...state.verdicts, [event.ua]: withoutType(event) } };
    }
    case 'finding': {
      if (state.findings.some((f) => f.fingerprint === event.fingerprint)) {
        throw new Error(`Finding ${event.fingerprint} landed twice, at ${event.at_ms} ms`);
      }
      return { ...s, findings: [...state.findings, withoutType(event)] };
    }
    case 'graded':
      if (state.grades !== null) throw new Error(`Graded twice, at ${event.at_ms} ms`);
      if (state.steps.find((st) => st.phase === 'grading')?.state === 'next') {
        throw new Error(`Graded at ${event.at_ms} ms, before grading started`);
      }
      return {
        ...s,
        grades: { technical_seo: event.technical_seo, ai_readability: event.ai_readability },
      };
    case 'ended': {
      const open = state.steps.filter((st) => st.state !== 'done').map((st) => st.phase);
      if (event.status !== 'failed' && open.length) {
        throw new Error(`Ended ${event.status} with ${open.join(', ')} not done`);
      }
      return { ...s, ended: event.status };
    }
  }
}

/**
 * Whether the map has its last pages: grading has begun, which the stages reach only after the
 * crawl and both tests, or the stream has ended.
 */
export function mapIsComplete(state: CrawlState): boolean {
  return state.ended !== null || state.steps.find((s) => s.phase === 'grading')?.state !== 'next';
}

/**
 * The state after every event at or before `t`. While the stream runs the elapsed time is `t`;
 * once it has ended, the clock stops at the end.
 */
export function stateAt(events: readonly ProgressEvent[], t: number): CrawlState {
  let s = INITIAL_STATE;
  for (const e of events) {
    if (e.at_ms > t) break;
    s = reduce(s, e);
  }
  return s.ended !== null || !Number.isFinite(t) ? s : { ...s, elapsed_ms: Math.max(t, s.last_ms) };
}

/**
 * How many fetches the contract snapshot carries. The contract leaves `recent_fetches` unbounded;
 * the one snapshot in the fixtures (clean-site's running check) carries three, so the projection
 * carries three and the two can be compared field for field.
 */
export const RECENT_FETCHES_IN_PROGRESS = 3;

/** The state as the contract's Progress snapshot. Identity and timing are not part of it. */
export function toProgress(state: CrawlState): Progress {
  return {
    steps: state.steps.map(({ phase, state: st }) => ({ phase, state: st })),
    pages_crawled: state.pages_crawled,
    pages_estimated: state.pages_estimated,
    links_found: state.links_found,
    elapsed_ms: state.elapsed_ms,
    recent_fetches: state.fetches
      .slice(-RECENT_FETCHES_IN_PROGRESS)
      .map(({ url, status, links }) => ({ url, status, links })),
  };
}
