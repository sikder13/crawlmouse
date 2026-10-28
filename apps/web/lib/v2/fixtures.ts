/**
 * The three CC-11 contract fixtures, parsed once, and the lookups every view model shares.
 * Server-side only: the datasets are large and the screens receive view models, not datasets.
 */
import {
  FixtureDatasetSchema,
  instant,
  type Check,
  type CrawlerResult,
  type Fix,
  type FixtureDataset,
} from '@crawlmouse/types/v2';
import badSite from '../fixtures/v2/bad-site.json';
import cleanSite from '../fixtures/v2/clean-site.json';
import challengedSite from '../fixtures/v2/challenged-site.json';

import { type FixtureName } from './fixture-names';

export { FIXTURE_NAMES, type FixtureName } from './fixture-names';

const RAW: Record<FixtureName, unknown> = {
  'bad-site': badSite,
  'clean-site': cleanSite,
  'challenged-site': challengedSite,
};

const parsed = new Map<FixtureName, FixtureDataset>();

export function fixture(name: FixtureName): FixtureDataset {
  let d = parsed.get(name);
  if (!d) {
    d = FixtureDatasetSchema.parse(RAW[name]);
    parsed.set(name, d);
  }
  return d;
}

export function findCheck(d: FixtureDataset, id: string): Check {
  const c = d.checks.find((x) => x.id === id);
  if (!c) throw new Error(`No check ${id} in the fixture`);
  return c;
}

export function siteOf(d: FixtureDataset, check: Check) {
  const s = d.sites.find((x) => x.id === check.site_id);
  if (!s) throw new Error(`No site ${check.site_id} for check ${check.id}`);
  return s;
}

export function crawlerOf(check: Check, ua: string): CrawlerResult {
  const r = check.crawlers.find((x) => x.ua === ua);
  if (!r) throw new Error(`Check ${check.id} has no result for ${ua}`);
  return r;
}

/**
 * The fixes a finished check knew about: first seen at or before it, and not resolved at its finish,
 * in the engine's order of impact. A fix is resolved when the latest `verified` or `reopened` event
 * at or before the finish is `verified`; marking a fix done is not a measurement and does not count.
 * Ranks are stored once, at each fix's last measured check, so an earlier check reuses that order
 * with the later fixes left out.
 */
export function fixesAsOf(d: FixtureDataset, check: Check): Fix[] {
  if (check.finished_at === null) throw new Error(`Check ${check.id} has not finished`);
  const end = instant(check.finished_at);
  const queued = (id: string) => instant(findCheck(d, id).queued_at);
  const asOf = instant(check.queued_at);
  const resolvedBy = (fix: Fix) => {
    const measured = d.fix_events
      .filter((e) => e.fix_id === fix.id && (e.kind === 'verified' || e.kind === 'reopened'))
      .filter((e) => instant(e.at) <= end)
      .sort((a, b) => instant(a.at) - instant(b.at));
    return measured.at(-1)?.kind === 'verified';
  };
  return d.fixes
    .filter((f) => f.site_id === check.site_id && queued(f.first_seen_check_id) <= asOf)
    .filter((f) => !resolvedBy(f))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.number - b.number);
}

/** The template a URL belongs to: `/` exactly, or the key's prefix before `{slug}`. */
export function templateOf(templateKeys: readonly string[], url: string): string {
  const path = new URL(url).pathname;
  const key = templateKeys.find((k) =>
    k === '/' ? path === '/' : path.startsWith(k.replace(/\{[^}]+\}$/, '')),
  );
  if (!key) throw new Error(`${url} matches no template of ${templateKeys.join(', ')}`);
  return key;
}

/** Milliseconds from the check's start to a timestamp. */
export const sinceStart = (check: Check, timestamp: string) => {
  if (!check.started_at) throw new Error(`Check ${check.id} has not started`);
  return instant(timestamp) - instant(check.started_at);
};
