/**
 * What the stream, notify and cancel tests share: checks in PGlite with every migration applied,
 * moved by the pipeline's own statements (`sqlPipelineStore`), batch results in a memory evidence
 * store, and recording stand-ins for the limiter, Inngest and the event capture.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { CrawlBatchResult } from '@crawlmouse/types/v2';
import { asRole } from '../../../../../__tests__/helpers/pglite-migrations';
import { accountOf, anonymousCheck } from '../../../../../__tests__/v2/_lib/door-pglite';
import { gzipJson } from '../../../../../lib/v2/pipeline/evidence';
import { progressOf, type Phase } from '../../../../../lib/v2/pipeline/steps/progress';
import { STARTED } from '../../../../../lib/v2/pipeline/stream.fixtures';
import { sqlStreamStore } from '../../../../../lib/v2/pipeline/stream-store';
import { memoryEvidenceStore } from '../../../../../lib/v2/pipeline/test-support/memory-evidence';
import { pgliteCheckReader } from '../../../../../lib/v2/pipeline/test-support/pglite';
import { sqlPipelineStore } from '../../../../../lib/v2/pipeline/test-support/sql-store';
import { ProgressEventSchema, type ProgressEvent } from '../../../../../lib/v2/progress';
import { capturePublicEvent, type CaptureBody } from '../../_lib/events';
import type { CancelDeps } from '../cancel/cancel';
import type { NotifyDeps } from '../notify/notify';
import type { StreamDeps } from '../stream/serve';

export interface Ids {
  siteId: string;
  checkId: string;
}

/** The clock the tests start at: five minutes after the fixtures' check started. */
export const NOW = STARTED + 5 * 60_000;
export const IP = '203.0.113.7';

/** A request from IP, with the headers a test names. */
export const request = (path: string, init: RequestInit = {}): Request =>
  new Request(`https://crawlmouse.test${path}`, {
    ...init,
    headers: { 'x-forwarded-for': IP, ...(init.headers as Record<string, string> | undefined) },
  });

/** `isMember` as production answers it: the caller's own role reads the site, under RLS. */
const memberUnderRls = (db: PGlite) => (siteId: string, userId: string) =>
  asRole(db, 'authenticated', userId, async (tx) => {
    const { rows } = await tx.query(`select id from public.sites where id = $1`, [siteId]);
    return rows.length === 1;
  });

export function harness(db: PGlite) {
  const memory = memoryEvidenceStore();
  const gets: string[] = [];
  let reading = 0;
  let mostAtOnce = 0;
  const clock = { now: NOW };
  /** Run, one per sleep, before the stream's next poll. */
  const betweenPolls: (() => Promise<unknown>)[] = [];
  const limits: string[] = [];
  const denied = new Set<string>();
  const counted = new Map<string, number>();
  const captured: CaptureBody[] = [];
  const sent: { id?: string; name: string; data: unknown }[] = [];
  const pipeline = sqlPipelineStore(db);
  const stream = sqlStreamStore(db);
  let snapshots = 0;

  const deps: StreamDeps & NotifyDeps & CancelDeps = {
    read: pgliteCheckReader(db),
    isMember: memberUnderRls(db),
    store: {
      ...pipeline,
      ...stream,
      snapshot: (id) => {
        snapshots++;
        return stream.snapshot(id);
      },
    },
    evidence: {
      async get(path) {
        gets.push(path);
        mostAtOnce = Math.max(mostAtOnce, ++reading);
        try {
          // A tick, so two reads started together would overlap here.
          await new Promise((r) => setTimeout(r, 0));
          return await memory.get(path);
        } finally {
          reading--;
        }
      },
    },
    /** Counts as `checkRateLimit` does: the first `limit` calls for a key are allowed. */
    async limit(key, limit) {
      limits.push(key);
      if ([...denied].some((prefix) => key.startsWith(prefix))) return { allowed: false };
      const n = (counted.get(key) ?? 0) + 1;
      counted.set(key, n);
      return { allowed: n <= limit };
    },
    captureFinished: (req, checkId, properties) =>
      capturePublicEvent(req, 'check_finished', checkId, properties, async (body) => {
        captured.push(body);
      }),
    async send(event) {
      sent.push(event);
    },
    clientIp: (req) => req.headers.get('x-forwarded-for') ?? 'unknown',
    now: () => clock.now,
    async sleep(ms) {
      clock.now += ms;
      await betweenPolls.shift()?.();
    },
  };

  return {
    deps,
    memory,
    clock,
    betweenPolls,
    denied,
    limits,
    captured,
    sent,
    gets,
    pipeline,
    mostAtOnce: () => mostAtOnce,
    snapshots: () => snapshots,
  };
}

export type Harness = ReturnType<typeof harness>;

/** An unkept site's queued check that expires an hour after NOW. */
export const queued = (db: PGlite, host: string): Promise<Ids> =>
  anonymousCheck(db, host, new Date(NOW + 60 * 60_000));

/** The check claimed by a run, at `phase`, started at the fixtures' STARTED. */
export async function claim(db: PGlite, h: Harness, ids: Ids, phase: Phase = 'crawl') {
  const outcome = await h.pipeline.claim(
    ids.checkId,
    `run-${ids.checkId}`,
    progressOf(phase, { pagesCrawled: 0, linksFound: 0 }, 0),
  );
  if (outcome !== 'claimed') throw new Error(`claim answered ${outcome}`);
  await db.query(`update public.checks set started_at = $2 where id = $1`, [
    ids.checkId,
    new Date(STARTED).toISOString(),
  ]);
}

export const running = async (db: PGlite, h: Harness, host: string, phase: Phase = 'crawl') => {
  const ids = await queued(db, host);
  await claim(db, h, ids, phase);
  return ids;
};

/** Stores crawl batch `n` as the pipeline's read step does, and moves the check's progress. */
export async function storeBatch(
  h: Harness,
  ids: Ids,
  n: number,
  result: CrawlBatchResult,
  totals: { pages: number; links: number },
  object: Uint8Array = gzipJson(result),
): Promise<string> {
  const path = `anon/${ids.siteId}/${ids.checkId}/batch-${n}.json.gz`;
  const at = new Date(h.clock.now).toISOString();
  await h.memory.put(path, object);
  await h.pipeline.upsertBatch({
    check_id: ids.checkId,
    batch: n,
    kind: 'crawl',
    nonce: `nonce-${String(n).padStart(16, '0')}`,
    posted_at: at,
    summary: { urls: result.pages.length, max_seconds: 60 },
  });
  await h.pipeline.endBatch(ids.checkId, n, {
    status: 'done',
    finished_at: at,
    summary: {
      pages: result.pages.filter((p) => p.outcome === 'fetched').length,
      links: result.link_edges.length,
      access_tests: 0,
      partial: false,
      release: null,
    },
    result_path: path,
  });
  await h.pipeline.progress(
    ids.checkId,
    progressOf(
      'crawl',
      { pagesCrawled: totals.pages, linksFound: totals.links },
      h.clock.now - STARTED,
    ),
    at,
  );
  return path;
}

/** Gives the check's site to `userId`'s account. */
export async function keep(db: PGlite, ids: Ids, userId: string): Promise<void> {
  const account = await accountOf(db, userId);
  await db.query(`update public.sites set account_id = $1 where id = $2`, [account.id, ids.siteId]);
  await db.query(`update public.checks set expires_at = null where id = $1`, [ids.checkId]);
}

export async function checkRow(db: PGlite, checkId: string) {
  const { rows } = await db.query<{
    status: string;
    failure_reason: string | null;
    notify_email: string | null;
    finished_at: Date | null;
  }>(`select status, failure_reason, notify_email, finished_at from public.checks where id = $1`, [
    checkId,
  ]);
  return rows[0]!;
}

export interface Group {
  id: string | null;
  events: ProgressEvent[];
}

/** A stream body as the groups it was framed in: events up to and including one with an `id:`. */
export function groupsOf(body: string): { groups: Group[]; retry: number | null; loose: number } {
  const groups: Group[] = [];
  let open: ProgressEvent[] = [];
  let retry: number | null = null;
  for (const block of body.split('\n\n')) {
    const lines = block.split('\n');
    const data = lines.find((l) => l.startsWith('data: '));
    const id = lines.find((l) => l.startsWith('id: '));
    const r = lines.find((l) => l.startsWith('retry: '));
    if (r) retry = Number(r.slice(7));
    if (!data) continue;
    open.push(ProgressEventSchema.parse(JSON.parse(data.slice(6))));
    if (id) {
      groups.push({ id: id.slice(4), events: open });
      open = [];
    }
  }
  return { groups, retry, loose: open.length };
}
