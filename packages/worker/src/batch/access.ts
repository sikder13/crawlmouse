import type { AccessCause, AccessTest, EvidenceClass, Verdict } from '@crawlmouse/types/v2';
import type { Clock } from '../clock.js';
import type { FetchOutcome } from '../fetch/fetcher.js';
import { CANARY, CONTROL, CRAWLERS, type Identity } from '../identities.js';
import { oursAllow, tokenAllows } from '../politeness/robots.js';
import { siteKeyOf } from '../politeness/site-key.js';
import { accessTestRow } from '../rows/access-test.js';
import { detached } from '../rows/detached.js';
import { mediaTypeOf, wordsIn } from '../rows/text.js';
import * as say from '../verdict/limitations.js';
import { BODY_TIEBREAK_BYTES, readResponse, type ResponseReading } from '../verdict/response.js';
import { decide, isRefusal, type Cell, type Observed, type Row } from '../verdict/table.js';
import type { Findings } from './findings.js';
import { politeFetch, type FetchContext, type NotRequested } from './polite-fetch.js';
import { pathOf, type BatchRobots, type SiteBlock } from './site-rules.js';

/**
 * An access batch: for each sampled page, one untagged browser control request, then each testable
 * crawler robots.txt allows, then, if any of them was refused, the tagged Googlebot canary. Pages are
 * taken one at a time and the requests within a page one at a time, all through the site's limiter.
 *
 * When the control is challenged or refused, the crawlers are not requested: what they got would show
 * how the site treats our requests, which the control has already shown.
 *
 * Rows per page: the control's, then one per crawler, then the canary's when it was requested.
 */

export interface AccessPage {
  url: string;
  template_key: string;
}

export interface AccessRun {
  ctx: FetchContext;
  robots: BatchRobots;
  findings: Findings;
  clock: Clock;
  checkId: string;
  /** Set when robots.txt, or the batch itself, keeps every page from being requested. */
  blocked: SiteBlock | NotRequested | null;
  /** Called after each page, for progress. */
  pageDone: () => void;
}

/** One identity's request on a page, or why it was not made for a batch-level reason. */
interface Probe {
  identity: Identity;
  fetch: FetchOutcome | null;
  observed: Observed;
  reading: ResponseReading | null;
  words: number | null;
  /** What limits the word count, when something does. */
  readNote: string | null;
  /** The response's media type, when it was served. */
  mediaType: string | null;
  /** Set when the request was not made because the batch or the site had stopped. */
  cut: NotRequested | null;
}

type RowMaker = (
  ua: string | null,
  identity: Identity,
  verdict: Verdict,
  evidence: EvidenceClass,
  cause: AccessCause | null,
  limitations: string[],
  fetch: FetchOutcome | null,
  words: number | null,
) => AccessTest;

const skipped = (identity: Identity, cut: NotRequested | null = null): Probe => ({
  identity,
  fetch: null,
  observed: 'not_requested',
  reading: null,
  words: null,
  readNote: null,
  mediaType: null,
  cut,
});

async function probe(run: AccessRun, url: string, identity: Identity): Promise<Probe> {
  const r = await politeFetch(run.ctx, url, identity, {
    offSite: 'stop',
    gate: run.robots.gate(identity),
  });
  if ('notRequested' in r) {
    run.findings.notRequested(r.notRequested);
    return skipped(identity, r.notRequested);
  }
  if (r.cut) run.findings.notRequested(r.cut);
  const reading = readResponse(r.fetch);
  const counted = reading.class === 'served' ? wordsIn(r.fetch) : { words: null, note: null };
  // The rows need only the start of the body. A copy, because a slice would hold the whole body.
  const fetch = { ...r.fetch, body: detached(r.fetch.body.slice(0, BODY_TIEBREAK_BYTES)) };
  return {
    identity,
    fetch,
    observed: reading.class,
    reading,
    words: counted.words,
    readNote: counted.note,
    mediaType: reading.class === 'served' ? mediaTypeOf(r.fetch) : null,
    cut: null,
  };
}

/** The verdict the control or the canary carries about its own request. */
function methodVerdict(role: 'control' | 'canary', o: Observed): Verdict {
  if (o === 'served') return 'allowed';
  if (role === 'control') {
    return o === 'challenged' || o === 'refused' ? 'edge_blocks_automation' : 'not_measured';
  }
  const canary: Partial<Record<Observed, Verdict>> = {
    challenged: 'challenged_ua',
    refused: 'refused_unverified',
    gone: 'refused_unverified',
    rate_limited: 'rate_limited',
    payment: 'payment_required',
    redirected_away: 'redirected_away',
  };
  return canary[o] ?? 'not_measured';
}

/** The cause a method request's own row names, from what its response showed. */
function methodCause(p: Probe): AccessCause | null {
  if (p.reading?.cloudflare1020) return 'cloudflare_1020';
  const causes: Partial<Record<Observed, AccessCause>> = {
    challenged: 'automation_challenge',
    rate_limited: 'rate_limit_429',
    payment: 'pay_per_crawl_402',
    redirected_away: 'cross_host_redirect',
  };
  return causes[p.observed] ?? null;
}

/** Limitations every row that shows this request's evidence carries. */
function notesOn(p: Probe): string[] {
  return [
    ...(p.fetch?.redirectStop ? [say.redirectStopped(p.fetch.redirectStop)] : []),
    ...(p.reading?.challenge ? [say.challengedBy(p.reading.challenge)] : []),
    ...(p.readNote ? [p.readNote] : []),
  ];
}

/** A value the table's row order guarantees; throwing names the broken guarantee instead of shipping a bad row. */
function guaranteed<T>(v: T | null, what: string): T {
  if (v === null) throw new Error(`access batch: ${what}`);
  return v;
}

export async function runAccess(
  run: AccessRun,
  pages: readonly AccessPage[],
): Promise<{ rows: AccessTest[]; complete: number }> {
  const rows: AccessTest[] = [];
  let complete = 0;
  for (const page of pages) {
    const pageRows = await accessPage(run, page);
    rows.push(...pageRows);
    // Complete: every tested crawler got a measured verdict on the page.
    if (pageRows.every((r) => r.ua === null || r.verdict !== 'not_measured')) complete++;
    run.pageDone();
  }
  return { rows, complete };
}

async function accessPage(run: AccessRun, page: AccessPage): Promise<AccessTest[]> {
  const row: RowMaker = (ua, identity, verdict, evidence, cause, limitations, fetch, words) =>
    accessTestRow({
      checkId: run.checkId,
      pageUrl: page.url,
      templateKey: page.template_key,
      ua,
      verdict,
      evidence,
      cause,
      limitations,
      fetch,
      identity,
      testedAt: fetch?.startedAt ?? run.clock.now(),
      words,
    });
  const notMeasured = (why: string) =>
    CRAWLERS.map((c) => row(c.token, c, 'not_measured', 'simulated', null, [why], null, null));

  const blocked = run.blocked;
  if (blocked && 'reason' in blocked) return notMeasured(say.notRequested(blocked));
  if (blocked) return siteBlockedRows(blocked, row);

  const rules = await run.robots.forUrl(page.url);
  if ('reason' in rules) return notMeasured(say.notRequested(rules));
  const robotsFetch = rules.reading.fetch;
  const parsed = rules.reading.state === 'rules' ? rules.reading.rules : null;
  const path = pathOf(page.url);
  const oursAllowed = oursAllow(parsed, path);

  const control = oursAllowed ? await probe(run, page.url, CONTROL) : skipped(CONTROL);
  if (control.fetch)
    run.ctx.sites.recordPage(siteKeyOf(page.url), control.observed === 'challenged');

  const crawlers: Probe[] = [];
  for (const identity of CRAWLERS) {
    const mayRequest =
      oursAllowed &&
      control.observed === 'served' &&
      tokenAllows(parsed, identity.robotsToken!, path);
    crawlers.push(mayRequest ? await probe(run, page.url, identity) : skipped(identity));
  }

  let canary = skipped(CANARY);
  let canaryNotRun: string | null = null;
  if (crawlers.some((c) => isRefusal(c.observed))) {
    if (tokenAllows(parsed, CANARY.robotsToken!, path)) {
      canary = await probe(run, page.url, CANARY);
      if (canary.cut) canaryNotRun = `was not requested, because ${say.stoppedBecause(canary.cut)}`;
    } else {
      canaryNotRun = 'was not requested, because robots.txt disallows Googlebot on this path';
    }
  }

  const rows: AccessTest[] = [];
  if (control.fetch) {
    rows.push(
      row(
        null,
        CONTROL,
        methodVerdict('control', control.observed),
        'simulated',
        methodCause(control),
        [say.CONTROL_REQUEST, ...notesOn(control)],
        control.fetch,
        control.words,
      ),
    );
  }

  const served = crawlers.filter((c) => c.observed === 'served').map((c) => c.identity.token!);
  for (const c of crawlers) {
    const cell: Cell = {
      robots: 'readable',
      crawlerAllowed: tokenAllows(parsed, c.identity.robotsToken!, path),
      oursAllowed,
      control: control.observed,
      crawler: c.observed,
      canary: canary.observed,
      words: c.words,
      controlWords: control.words,
      sameType: c.mediaType !== null && c.mediaType === control.mediaType,
    };
    const decided = decide(cell);
    const { fetch, words, limitations } = evidenceFor(decided, c);
    rows.push(
      row(
        c.identity.token,
        c.identity,
        decided.verdict,
        decided.evidence,
        decided.cause.of({ control: control.reading, crawler: c.reading }),
        limitations,
        fetch,
        words,
      ),
    );
  }

  if (canary.fetch) {
    rows.push(
      row(
        null,
        CANARY,
        methodVerdict('canary', canary.observed),
        'simulated',
        methodCause(canary),
        [say.CANARY_REQUEST, ...notesOn(canary)],
        canary.fetch,
        canary.words,
      ),
    );
  }
  return rows;

  /** Which request a crawler's row shows as its evidence, and what that evidence cannot show. */
  function evidenceFor(
    decided: Row,
    c: Probe,
  ): { fetch: FetchOutcome | null; words: number | null; limitations: string[] } {
    switch (decided.id) {
      case 'disallowed':
        return { fetch: robotsFetch, words: null, limitations: [say.ROBOTS_DISALLOWS_CRAWLER] };
      case 'ours_disallowed':
        return { fetch: robotsFetch, words: null, limitations: [say.ROBOTS_DISALLOWS_US] };
      case 'control_not_requested':
        return {
          fetch: null,
          words: null,
          limitations: [
            say.notRequested(guaranteed(control.cut, 'control skipped without a reason')),
          ],
        };
      case 'control_blocked':
        return {
          fetch: control.fetch,
          words: control.words,
          limitations: [say.controlBlocked(control.observed), ...notesOn(control)],
        };
      case 'control_unusable':
        return {
          fetch: control.fetch,
          words: control.words,
          limitations: [say.controlUnusable(control.observed), ...notesOn(control)],
        };
      case 'crawler_not_requested':
        return {
          fetch: null,
          words: null,
          limitations: [say.notRequested(guaranteed(c.cut, 'crawler skipped without a reason'))],
        };
      case 'served_uncounted':
        return {
          fetch: c.fetch,
          words: c.words,
          limitations: [
            say.TAGGED_REQUEST,
            say.UNCOUNTED,
            ...notesOn(c),
            ...notesOn(control).map(say.aboutControl),
          ],
        };
      case 'served_thin':
        return {
          fetch: c.fetch,
          words: c.words,
          limitations: [say.TAGGED_REQUEST, say.thin(c.words!, control.words!), ...notesOn(c)],
        };
      case 'refused_canary_served':
      case 'refused':
        return {
          fetch: c.fetch,
          words: c.words,
          limitations: [
            say.TAGGED_REQUEST,
            say.canaryReading(
              canary.observed,
              canaryNotRun,
              served.filter((t) => t !== c.identity.token),
            ),
            ...notesOn(c),
          ],
        };
      default:
        return { fetch: c.fetch, words: c.words, limitations: [say.TAGGED_REQUEST, ...notesOn(c)] };
    }
  }
}

/** Every crawler's row on a page of a batch that robots.txt keeps from fetching any page. */
function siteBlockedRows(blocked: SiteBlock, row: RowMaker): AccessTest[] {
  const decided = decide({
    robots: 'blocks_site',
    crawlerAllowed: true,
    oursAllowed: true,
    control: 'not_requested',
    crawler: 'not_requested',
    canary: 'not_requested',
    words: null,
    controlWords: null,
    sameType: false,
  });
  const limitation = say.siteBlocked(blocked);
  return CRAWLERS.map((c) =>
    row(
      c.token,
      c,
      decided.verdict,
      decided.evidence,
      null,
      [limitation],
      blocked.rules.reading.fetch,
      null,
    ),
  );
}
