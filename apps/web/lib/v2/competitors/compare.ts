/**
 * Row 18: auditing a site's competitors and comparing them, the work `crawlmouse.competitors.compare`
 * (inngest/competitors.ts) runs in steps.
 *
 * A competitor is audited as a site no account keeps, as a visitor's public check is: one site row per
 * host (`competitorSiteId`), shared by every customer who names it, with no account, schedule or
 * owner. Its check is requested through the pipeline with a fresh random id and the trigger `manual`,
 * so it is crawled with a visitor's politeness and page cap, and it expires with the other unkept
 * checks. Nothing of the customer's (account, site, host or check) is written to it: the link from the
 * customer's check to the competitor's exists only in the run that joins them, and the result is
 * copied the other way, as a `CompetitorSnapshot` in the customer's `checks.competitors`.
 *
 * Before a new crawl: the SSRF guard on `https://{host}/` (the public start's `admitSiteHost`), then
 * the day's ceiling on starts and the host's hourly bucket, the limits a visitor's start counts
 * against. A host refused by any of them is skipped, not retried. A check of the host that ended
 * under `COMPETITOR_REUSE_MS` ago is reused instead of crawling again, so many customers naming one
 * host crawl it once a day at most.
 */
import { stableId } from '@crawlmouse/engine/v2/pipeline';
import type { Check, CompetitorSnapshot } from '@crawlmouse/types/v2';
import { normalizeDomain } from '../../domain';
import { competitorSnapshot } from './snapshot';

/** How long an ended check of a competitor is reused rather than crawled again. */
export const COMPETITOR_REUSE_MS = 24 * 60 * 60 * 1000;

/** The site row a competitor host is audited under: one per host, whoever names it. */
export const competitorSiteId = (host: string): string =>
  stableId('competitor_site', host.toLowerCase());

/** What `plan` reads of a finished check, its site and its account. */
export interface PlanRow {
  checkStatus: Check['status'];
  siteId: string;
  host: string;
  /** An account keeps the site. */
  kept: boolean;
  /** The site is another site's staging site. */
  staging: boolean;
  removed: boolean;
  paused: boolean;
  competitorHosts: string[];
  /** The account's `competitor_limit`; 0 for a site no account keeps. */
  competitorLimit: number;
}

export interface CompetitorStore {
  /** Null when the check is not there. */
  planRow(checkId: string): Promise<PlanRow | null>;
  /** The site's latest finished or partial check. */
  latestEnded(siteId: string): Promise<{ checkId: string; finishedAt: string } | null>;
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
    /** The hourly bucket of a host without its leading `www.`. */
    domain(domain: string): Promise<boolean>;
  };
  /** A fresh random check id. */
  newId(): string;
  /** `requestCheck` for the unkept site `siteId` with the fresh id `checkId`; answers the check id. */
  request(siteId: string, checkId: string): Promise<string>;
}

export type PlanAnswer = { skip: string } | { hosts: string[] };
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
  start(host: string): Promise<StartAnswer>;
  ended(checkIds: string[]): Promise<string[]>;
  write(checkId: string, entries: Entry[]): Promise<{ written: number }>;
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
      if (!row.kept) return { skip: 'unkept' };
      if (row.staging) return { skip: 'staging' };
      if (row.removed) return { skip: 'removed' };
      if (row.paused) return { skip: 'paused' };
      if (!deps.shown()) return { skip: 'hidden' };
      if (row.competitorLimit <= 0) return { skip: 'not_in_plan' };
      const own = normalizeDomain(row.host);
      const hosts: string[] = [];
      for (const raw of row.competitorHosts) {
        const host = raw.trim().toLowerCase();
        if (host === '' || normalizeDomain(host) === own || hosts.includes(host)) continue;
        hosts.push(host);
      }
      if (hosts.length === 0) return { skip: 'no_competitors' };
      return { hosts: hosts.slice(0, row.competitorLimit) };
    },

    async start(host) {
      const siteId = competitorSiteId(host);
      const last = await store.latestEnded(siteId);
      if (last && deps.now() - Date.parse(last.finishedAt) < COMPETITOR_REUSE_MS) {
        return { checkId: last.checkId, reused: true };
      }
      if (deps.paused()) return { skip: 'crawl_paused' };
      if (!(await deps.admit(host))) return { skip: 'refused_host' };
      if (!(await deps.limits.global())) return { skip: 'capacity' };
      if (!(await deps.limits.domain(normalizeDomain(host)))) return { skip: 'domain_limit' };
      await store.ensureSite(siteId, host);
      return { checkId: await deps.request(siteId, deps.newId()), reused: false };
    },

    async ended(checkIds) {
      return checkIds.length === 0 ? [] : store.endedOf(checkIds);
    },

    async write(checkId, entries) {
      const snapshots: CompetitorSnapshot[] = [];
      for (const { host, checkId: theirs } of entries) {
        if (theirs === null) continue;
        const check = await store.endedCheck(theirs);
        const snapshot = check && competitorSnapshot(check, host);
        if (snapshot) snapshots.push(snapshot);
      }
      if (snapshots.length === 0) return { written: 0 };
      return { written: (await store.writeCompetitors(checkId, snapshots)) ? snapshots.length : 0 };
    },
  };
}
