/**
 * The three CC-11 contract fixtures and the built one (CC-20a), parsed once, and the lookups the view
 * models share.
 * Server-side only: the datasets are large and the screens receive view models, not datasets.
 */
import {
  FixtureDatasetSchema,
  instant,
  type Check,
  type CrawlerResult,
  type FixtureDataset,
} from '@crawlmouse/types/v2';
import badSite from '../fixtures/v2/bad-site.json';
import cleanSite from '../fixtures/v2/clean-site.json';
import challengedSite from '../fixtures/v2/challenged-site.json';
import builtSite from '../fixtures/v2/built-site.json';

import { type FixtureName } from './fixture-names';

export { FIXTURE_NAMES, type FixtureName } from './fixture-names';
export { findCheck, fixesAsOf, siteOf, type ViewDataset } from './dataset-lookups';

const RAW: Record<FixtureName, unknown> = {
  'bad-site': badSite,
  'clean-site': cleanSite,
  'challenged-site': challengedSite,
  'built-site': builtSite,
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

export function crawlerOf(check: Check, ua: string): CrawlerResult {
  const r = check.crawlers.find((x) => x.ua === ua);
  if (!r) throw new Error(`Check ${check.id} has no result for ${ua}`);
  return r;
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
