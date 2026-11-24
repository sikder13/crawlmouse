/**
 * What the app sends the crawl worker and what comes back (SPEC 12 routes; docs/specs/v2/12-crawl-worker.md).
 * The worker checks the body strictly, so these shapes are exactly its BatchRequestSchema less the two
 * fields the client fills in itself: the nonce's JWT and nothing else. The caller picks the nonce, so
 * the pipeline can record it before the request leaves.
 */

export type BatchKind = 'crawl' | 'access';

/** The worker refuses a batch without all three; there are no defaults. */
export interface BatchBudget {
  max_requests: number;
  max_bytes: number;
  max_seconds: number;
}

interface BatchCommon {
  check_id: string;
  site_id: string;
  /** The site's host, lower case, no port: the JWT names it and every URL must be on it. */
  site_host: string;
  batch: number;
  /** Single use: 16 to 128 of `[A-Za-z0-9_-]`. */
  nonce: string;
  budget: BatchBudget;
}

export type BatchPost =
  | (BatchCommon & { kind: 'crawl'; urls: readonly string[] })
  | (BatchCommon & {
      kind: 'access';
      pages: readonly { url: string; template_key: string }[];
    });

/** `GET /batch/{id}`: the result is unparsed here; the pipeline validates it with BatchResultSchema. */
export type PollResult =
  | { status: 'running'; progress: unknown }
  | { status: 'done'; result: unknown }
  | { status: 'failed' }
  | { status: 'not_found' };

/** A page a running batch has finished, with the fields its stored row will hold. */
export interface LivePage {
  url: string;
  status: number;
  ms: number;
  links: number;
  identity: string;
  edges: { from: string; to: string; js_only: boolean }[];
}

/** What a running batch has read so far, counted as its result will count it. */
export interface LiveProgress {
  pages: number;
  links: number;
  /** Whether the batch's first URL was served to us; false from a worker that does not say. */
  homepageRead: boolean;
  /** How many finished pages the worker holds for this batch. */
  total: number;
  /** The finished pages from the offset asked for, a bounded number at a time. */
  fresh: LivePage[];
}

export interface WorkerClient {
  /** Resolves with the worker's batch id once it answered 202; throws WorkerError otherwise. */
  /** `signals`: the worker said it will signal this batch's end (PR 5a). */
  postBatch(batch: BatchPost): Promise<{ batch_id: string; signals: boolean }>;
  pollBatch(batchId: string): Promise<PollResult>;
  /**
   * A running batch's counts and the pages it finished from `after`, for the live screen; null for
   * anything else, a failed read included. It never throws and waits at most PROGRESS_TIMEOUT_MS,
   * so a slow worker cannot stall a stream.
   */
  readProgress(batchId: string, after?: number): Promise<LiveProgress | null>;
  readMetrics(): Promise<unknown>;
  /**
   * A page's two renders, read on the worker's reader thread (questions/042, design C): each side's
   * words, whether either is a challenge, and the links only the rendered side has. Null for
   * anything else (a refusal, a read the thread stopped, a timeout, an answer of the wrong shape); it
   * never throws. Optional so a fake worker need not have it.
   */
  measureRendered?(
    staticHtml: string,
    renderedHtml: string,
    pageUrl: string,
  ): Promise<RenderedReading | null>;
}

/** What the worker reads from a page's two renders: the engine's `RenderedReading`. */
export interface RenderedReading {
  raw_words: number;
  rendered_words: number;
  challenged: boolean;
  links: { js_only: string[]; js_only_count: number; truncated: boolean } | null;
}

/**
 * Why a request to the worker did not give what was asked. The worker's refusal codes (SPEC 12
 * "Refusals") map onto these; `timeout`, `network` and `server` are ours.
 */
export type WorkerErrorKind =
  | 'busy'
  | 'batch_exists'
  | 'nonce_replayed'
  | 'paused'
  | 'unauthorized'
  | 'forbidden'
  | 'invalid'
  | 'too_large'
  | 'timeout'
  | 'network'
  | 'server';

/**
 * A failed worker request. The message names the kind, the HTTP status and the worker's error code,
 * and nothing else: never a header, a body, a JWT or a key.
 */
export class WorkerError extends Error {
  constructor(
    readonly kind: WorkerErrorKind,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(
      `worker request failed: ${kind}${status === null ? '' : ` (${status}${code ? ` ${code}` : ''})`}`,
    );
    this.name = 'WorkerError';
  }
}

/** The worker's id for a batch (packages/worker/src/batch/request.ts batchIdOf). */
export const batchIdOf = (checkId: string, batch: number): string => `${checkId}:${batch}`;
