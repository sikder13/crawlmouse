/**
 * Row 18: auditing a site's competitors and comparing them, the work `crawlmouse.competitors.compare`
 * (inngest/competitors.ts) runs in steps.
 *
 * A competitor is audited as a site no account keeps, as a visitor's public check is: one site row per
 * host without its leading `www.` (`competitorSiteId`), shared by every customer who names it, with
 * no account, schedule or owner. Its check is requested through the pipeline with a fresh random id
 * and the trigger `manual`, so it is crawled with a visitor's politeness and page cap, and it expires
 * with the other unkept checks. Nothing of the customer's (account, site, host or check) is written
 * to it: the link from the customer's check to the competitor's exists only in the run that joins
 * them, and the result is copied the other way, as a `CompetitorSnapshot` in the customer's
 * `checks.competitors`.
 *
 * `start` crawls a host only when its site row has no check under way and no ended check it may
 * reuse: one that ended under `COMPETITOR_REUSE_MS` ago and is not due to expire within
 * `COMPETITOR_HOLD_MS`. A check under way is waited on, which also makes a retried start step find
 * the check its first attempt requested. Two customers' runs reading the host's row in the same
 * moment, before either has requested a check, can each request one: the read and the request are
 * not one transaction. A site row that an account has come
 * to keep is not a competitor's any more: `start` copies none of its checks and requests none.
 *
 * Before a new crawl: the crawl pause, the SSRF guard on `https://{host}/` (the public start's
 * `admitSiteHost`), the account's own daily bucket (in place of a visitor's per-address bucket),
 * the day's ceiling on starts and the host's hourly bucket. A host refused by any of them is
 * skipped, not retried.
 *
 * `write` copies the snapshots of the hosts the site lists when it writes, in that order: a host the
 * member removed since the plan is left out, and a listed host with no new snapshot keeps the one
 * the check already holds.
 *
 * Two runs for one site can overlap, since a sleeping run holds no concurrency slot, and they can
 * copy different checks of one host. Each run's `write` replaces a host's snapshot with the one
 * it copied, so the run that writes last decides it.
 *
 * The site row keeps the host as spelled by the customer whose run inserted the row (`www.` or
 * not), and the crawl starts there.
 */
import { stableId } from '@crawlmouse/engine/v2/pipeline';
import type { Check, CompetitorSnapshot } from '@crawlmouse/types/v2';
import { normalizeDomain } from '../../domain';
import { competitorSnapshot } from './snapshot';

/** How long an ended check of a competitor is reused rather than crawled again. */
export const COMPETITOR_REUSE_MS = 24 * 60 * 60 * 1000;
/**
 * How long a reused check must still be kept: the function's polls (2 h 59 min,
 * inngest/competitors.ts) and an hour's room, so the daily expiry cannot delete it before the copy.
 */
export const COMPETITOR_HOLD_MS = 4 * 60 * 60 * 1000;

/** The site row a competitor host is audited under: one per host without `www.`, whoever names it. */
export const competitorSiteId = (host: string): string =>
  stableId('competitor_site', normalizeDomain(host));

/** What `plan` reads of a finished check, its site and its account. */
export interface PlanRow {
  checkStatus: Check['status'];
  siteId: string;
  host: string;
  /** Null for a site no account keeps. */
  accountId: string | null;
  /** The site is another site's staging site. */
  staging: boolean;
  removed: boolean;
  paused: boolean;
  competitorHosts: string[];
  /** The account's `competitor_limit`; 0 for a site no account keeps. */
  competitorLimit: number;
  /** The account's `site_limit`; 0 for a site no account keeps. */
  siteLimit: number;
}

/** A competitor site row as `start` reads it. */
export interface CompetitorState {
  /** An account keeps the row. */
  kept: boolean;
  /** Its check that is queued, running or deferred, if any. */
  live: { checkId: string; status: 'queued' | 'running' | 'deferred' } | null;
  /** Its latest finished or partial check, if any. */
  ended: { checkId: string; finishedAt: string; expiresAt: string | null } | null;
}

export interface CompetitorStore {
  /** Null when the check is not there. */
  planRow(checkId: string): Promise<PlanRow | null>;
  /** The site's latest finished or partial check. */
  latestEnded(siteId: string): Promise<{ checkId: string; finishedAt: string } | null>;
  /** Null when there is no site row under `siteId`. */
  competitorState(siteId: string): Promise<CompetitorState | null>;
  /** Inserts a site no account keeps under `siteId`, unless one is there. */
  ensureSite(siteId: string, host: string): Promise<void>;
  /** The check, when it is finished or partial; otherwise null. */
  endedCheck(checkId: string): Promise<Check | null>;
  /** Which of `checkIds` have ended: finished, partial or failed. */
  endedOf(checkIds: readonly string[]): Promise<string[]>;
  /** Sets the check's `competitors`, when it has ended; false when no row was changed. */
  writeCompetitors(checkId: string, snapshots: readonly CompetitorSnapshot[]): Promise<boolean>;
}

export interface CompetitorDeps {
  store: CompetitorStore;
  /** `featureShown('competitors')`. */
  shown(): boolean;
  /** `isCrawlPaused` (lib/crawl-pause.ts): no new crawl starts while it is set. */
  paused(): boolean;
  /** Milliseconds since the epoch. */
  now(): number;
  /** The SSRF guard: whether `https://{host}/` may be fetched. */
  admit(host: string): Promise<boolean>;
  limits: {
    /** The day's ceiling on check starts; false when reached or not counted. */
    global(): Promise<boolean>;
    /** The account's competitor crawls today, at most `cap`; false when reached or not counted. */
    account(accountId: string, cap: number): Promise<boolean>;
    /** The hourly bucket of a host without its leading `www.`. */
    domain(domain: string): Promise<boolean>;
  };
  /** A fresh random check id. */
  newId(): string;
  /** `requestCheck` for the unkept site `siteId` with the fresh id `checkId`; answers the check id. */
  request(siteId: string, checkId: string): Promise<string>;
}

export type PlanAnswer = { skip: string } | { hosts: string[]; accountId: string; cap: number };
export type StartAnswer = { skip: string } | { checkId: string; reused: boolean };
export interface Entry {
  host: string;
  /** The competitor's check, or null when none was started. */
  checkId: string | null;
}

export interface CompetitorWork {
  /** The site's latest ended check, which a changed list is planned against. */
  latest(siteId: string): Promise<string | null>;
  plan(checkId: string): Promise<PlanAnswer>;
  start(host: string, accountId: string, cap: number): Promise<StartAnswer>;
  ended(checkIds: string[]): Promise<string[]>;
  write(checkId: string, entries: Entry[]): Promise<{ written: number }>;
}

/** The hosts a site lists, lower case, without its own host and repeats, `limit` at most. */
function listed(row: PlanRow, limit: number): string[] {
  const own = normalizeDomain(row.host);
  const hosts: string[] = [];
  const seen = new Set<string>();
  for (const raw of row.competitorHosts) {
    const host = raw.trim().toLowerCase();
    const key = host === '' ? '' : normalizeDomain(host);
    if (key === '' || key === own || seen.has(key)) continue;
    seen.add(key);
    hosts.push(host);
  }
  return hosts.slice(0, limit);
}

export function competitorWork(deps: CompetitorDeps): CompetitorWork {
  const { store } = deps;
  return {
    async latest(siteId) {
      return (await store.latestEnded(siteId))?.checkId ?? null;
    },

    async plan(checkId) {
      const row = await store.planRow(checkId);
      if (row === null) return { skip: 'check_missing' };
      if (row.checkStatus !== 'finished' && row.checkStatus !== 'partial')
        return { skip: 'not_ended' };
      // A competitor's own check is on a site no account keeps, so it never plans: no competitor
      // of a competitor is audited.
      if (row.accountId === null) return { skip: 'unkept' };
      if (row.staging) return { skip: 'staging' };
      if (row.removed) return { skip: 'removed' };
      if (row.paused) return { skip: 'paused' };
      if (!deps.shown()) return { skip: 'hidden' };
      if (row.competitorLimit <= 0) return { skip: 'not_in_plan' };
      const hosts = listed(row, row.competitorLimit);
      if (hosts.length === 0) return { skip: 'no_competitors' };
      return {
        hosts,
        accountId: row.accountId,
        cap: Math.max(1, row.siteLimit) * row.competitorLimit,
      };
    },

    async start(host, accountId, cap) {
      const siteId = competitorSiteId(host);
      const state = await store.competitorState(siteId);
      if (state?.kept) return { skip: 'site_kept' };
      if (state?.live) {
        // A queued check's event may not have gone out (requestCheck inserts, then sends): request
        // it again under its own id, which inserts nothing and sends the same event id, which
        // Inngest drops when the first send arrived.
        if (state.live.status === 'queued') await deps.request(siteId, state.live.checkId);
        return { checkId: state.live.checkId, reused: false };
      }
      const last = state?.ended;
      const now = deps.now();
      if (
        last &&
        now - Date.parse(last.finishedAt) < COMPETITOR_REUSE_MS &&
        (last.expiresAt === null || Date.parse(last.expiresAt) - now > COMPETITOR_HOLD_MS)
      ) {
        return { checkId: last.checkId, reused: true };
      }
      if (deps.paused()) return { skip: 'crawl_paused' };
      if (!(await deps.admit(host))) return { skip: 'refused_host' };
      // The account's bucket first: a bucket counts a refused request too, so an account over its
      // cap spends nothing of the day's ceiling that visitors share.
      if (!(await deps.limits.account(accountId, cap))) return { skip: 'account_limit' };
      if (!(await deps.limits.global())) return { skip: 'capacity' };
      if (!(await deps.limits.domain(normalizeDomain(host)))) return { skip: 'domain_limit' };
      await store.ensureSite(siteId, host);
      return { checkId: await deps.request(siteId, deps.newId()), reused: false };
    },

    async ended(checkIds) {
      return checkIds.length === 0 ? [] : store.endedOf(checkIds);
    },

    async write(checkId, entries) {
      const row = await store.planRow(checkId);
      if (row === null || row.accountId === null || row.removed) return { written: 0 };
      const current = listed(row, row.competitorLimit);
      const fresh = new Map<string, CompetitorSnapshot>();
      for (const { host, checkId: theirs } of entries) {
        if (theirs === null) continue;
        const check = await store.endedCheck(theirs);
        const snapshot = check && competitorSnapshot(check, host);
        if (snapshot) fresh.set(normalizeDomain(host), snapshot);
      }
      const held = (await store.endedCheck(checkId))?.competitors ?? [];
      const heldOf = (key: string) => held.find((s) => normalizeDomain(s.host) === key);
      const snapshots = current.flatMap((host) => {
        const key = normalizeDomain(host);
        const s = fresh.get(key) ?? heldOf(key);
        return s ? [s] : [];
      });
      const written = current.filter((h) => fresh.has(normalizeDomain(h))).length;
      if (JSON.stringify(snapshots) === JSON.stringify(held)) return { written };
      return { written: (await store.writeCompetitors(checkId, snapshots)) ? written : 0 };
    },
  };
}
