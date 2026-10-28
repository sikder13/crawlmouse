import type { AccessCause, AccessTest, EvidenceClass, Verdict } from '@crawlmouse/types/v2';
import type { Clock } from '../clock.js';
import type { FetchOutcome } from '../fetch/fetcher.js';
import { CANARY, CONTROL, CRAWLERS, type Identity } from '../identities.js';
import { oursAllow, tokenAllows } from '../politeness/robots.js';
import { siteKeyOf } from '../politeness/site-key.js';
import { accessTestRow } from '../rows/access-test.js';
import { wordsIn } from '../rows/text.js';
import * as say from '../verdict/limitations.js';
import { BODY_TIEBREAK_BYTES, readResponse, type ResponseReading } from '../verdict/response.js';
import { decide, isRefusal, type Cell, type Observed, type Row } from '../verdict/table.js';
import type { Findings } from './findings.js';
import { politeFetch, type FetchContext } from './polite-fetch.js';
import { MAX_CRAWL_DELAY_S, originBlock, pathOf, type BatchRobots } from './site-rules.js';

/**
 * An access batch: for each sampled page, one untagged browser control request, then each testable
 * crawler robots.txt allows, then, if any of them was refused, the tagged Googlebot canary. Pages are
 * taken one at a time and the requests within a page one at a time, all through the site's limiter.
 *
 * When the control is challenged or refused, the crawlers are not requested: what they got would show
 * how the site treats our requests, which the control has already shown.
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
  /** Set when the request was not made because the batch or the site had stopped. */
  cut: string | null;
  /** What limits the word count, when something does. */
  readNote: string | null;
}

const skipped = (identity: Identity): Probe => ({
  identity,
  fetch: null,
  observed: 'not_requested',
  reading: null,
  words: null,
  cut: null,
  readNote: null,
});

async function probe(run: AccessRun, url: string, identity: Identity): Promise<Probe> {
  const r = await politeFetch(run.ctx, url, identity, {
    offSite: 'stop',
    mayRequest: run.robots.mayRequest(identity),
  });
  if ('notRequested' in r) {
    run.findings.notRequested(r.notRequested);
    return { ...skipped(identity), cut: say.notRequested(r.notRequested) };
  }
  const reading = readResponse(r.fetch);
  const { words, note } =
    reading.class === 'served' ? wordsIn(r.fetch) : { words: null, note: null };
  // The rows need the start of the body only; a page's eight responses are not held whole.
  const fetch = { ...r.fetch, body: r.fetch.body.slice(0, BODY_TIEBREAK_BYTES) };
  return { identity, fetch, observed: reading.class, reading, words, cut: null, readNote: note };
}

/** The verdict the control or the canary carries about its own request. */
function methodVerdict(role: 'control' | 'canary', o: Observed): Verdict {
  if (o === 'served') return 'allowed';
  if (role === 'control')
    return o === 'challenged' || o === 'refused' ? 'edge_blocks_automation' : 'not_measured';
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

const redirectNote = (p: Probe): string[] =>
  p.fetch?.redirectStop ? [say.redirectStopped(p.fetch.redirectStop)] : [];

const readNote = (p: Probe): string[] => (p.readNote ? [p.readNote] : []);

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
    const result = await accessPage(run, page);
    rows.push(...result.rows);
    if (result.complete) complete++;
    run.pageDone();
  }
  return { rows, complete };
}

async function accessPage(
  run: AccessRun,
  page: AccessPage,
): Promise<{ rows: AccessTest[]; complete: boolean }> {
  const row = (
    ua: string | null,
    identity: Identity,
    verdict: Verdict,
    evidence: EvidenceClass,
    cause: AccessCause | null,
    limitations: string[],
    fetch: FetchOutcome | null,
    words: number | null,
  ): AccessTest =>
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

  const rules = await run.robots.forUrl(page.url);
  if ('reason' in rules) {
    run.findings.notRequested(rules);
    const why = say.notRequested(rules);
    const rows = CRAWLERS.map((c) =>
      row(c.token, c, 'not_measured', 'simulated', null, [why], null, null),
    );
    return { rows, complete: false };
  }
  run.findings.origin(rules);
  const reading = rules.reading;
  const robotsFetch = reading.fetch;
  if (originBlock(rules) === 'crawl_delay_over_limit') {
    const why = say.crawlDelayOverLimit(rules.crawlDelayS!, MAX_CRAWL_DELAY_S);
    const rows = CRAWLERS.map((c) =>
      row(c.token, c, 'not_measured', 'declared', null, [why], robotsFetch, null),
    );
    return { rows, complete: false };
  }

  const parsed = reading.state === 'rules' ? reading.rules : null;
  const path = pathOf(page.url);
  const unreachable = reading.state === 'unreachable' || reading.state === 'refused';
  const oursAllowed = oursAllow(parsed, path);
  const rows: AccessTest[] = [];

  let control = skipped(CONTROL);
  if (!unreachable && oursAllowed) {
    control = await probe(run, page.url, CONTROL);
    if (control.fetch) {
      run.ctx.sites.recordPage(siteKeyOf(page.url), control.observed === 'challenged');
      rows.push(
        row(
          null,
          CONTROL,
          methodVerdict('control', control.observed),
          'simulated',
          methodCause(control),
          [say.CONTROL_REQUEST, ...redirectNote(control), ...readNote(control)],
          control.fetch,
          control.words,
        ),
      );
    }
  }

  const crawlers: Probe[] = [];
  for (const identity of CRAWLERS) {
    const mayRequest =
      !unreachable &&
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
      if (canary.cut) canaryNotRun = 'not requested, because the batch had stopped';
    } else {
      canaryNotRun = 'not requested, because robots.txt disallows Googlebot on this path';
    }
    if (canary.fetch) {
      rows.push(
        row(
          null,
          CANARY,
          methodVerdict('canary', canary.observed),
          'simulated',
          methodCause(canary),
          [say.CANARY_REQUEST, ...redirectNote(canary)],
          canary.fetch,
          canary.words,
        ),
      );
    }
  }

  const served = crawlers.filter((c) => c.observed === 'served').map((c) => c.identity.token!);
  for (const c of crawlers) {
    const cell: Cell = {
      robots: unreachable ? 'unreachable' : 'readable',
      crawlerAllowed: tokenAllows(parsed, c.identity.robotsToken!, path),
      oursAllowed,
      control: control.observed,
      crawler: c.observed,
      canary: canary.observed,
      words: c.words,
      controlWords: control.words,
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

  const cut = [control, canary, ...crawlers].some((p) => p.cut !== null);
  return { rows, complete: !unreachable && !cut };

  /** Which request a crawler's row shows as its evidence, and what that evidence cannot show. */
  function evidenceFor(
    decided: Row,
    c: Probe,
  ): { fetch: FetchOutcome | null; words: number | null; limitations: string[] } {
    switch (decided.id) {
      case 'robots_unreachable':
        return {
          fetch: robotsFetch,
          words: null,
          limitations: [
            reading.state === 'unreachable' ? say.robotsUnreachable(reading.why) : say.SITE_REFUSED,
          ],
        };
      case 'disallowed':
        return { fetch: robotsFetch, words: null, limitations: [say.ROBOTS_DISALLOWS_CRAWLER] };
      case 'ours_disallowed':
        return { fetch: robotsFetch, words: null, limitations: [say.ROBOTS_DISALLOWS_US] };
      case 'control_not_requested':
        return {
          fetch: null,
          words: null,
          limitations: [guaranteed(control.cut, 'control skipped without a reason')],
        };
      case 'control_blocked':
        return {
          fetch: control.fetch,
          words: control.words,
          limitations: [say.controlBlocked(control.observed)],
        };
      case 'control_unusable':
        return {
          fetch: control.fetch,
          words: control.words,
          limitations: [say.controlUnusable(control.observed), ...redirectNote(control)],
        };
      case 'crawler_not_requested':
        return {
          fetch: null,
          words: null,
          limitations: [guaranteed(c.cut, 'crawler skipped without a reason')],
        };
      case 'served_thin':
        return {
          fetch: c.fetch,
          words: c.words,
          limitations: [say.TAGGED_REQUEST, say.thin(c.words!, control.words!), ...readNote(c)],
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
          ],
        };
      default:
        return {
          fetch: c.fetch,
          words: c.words,
          limitations: [say.TAGGED_REQUEST, ...redirectNote(c), ...readNote(c)],
        };
    }
  }
}
