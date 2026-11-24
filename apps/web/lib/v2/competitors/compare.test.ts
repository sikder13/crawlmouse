/**
 * Row 18: which finished checks audit their site's competitors, how each competitor's check is
 * started or reused, and what is written back. The store, the pipeline's request and the limits are
 * fakes here; the SQL is tested against PGlite in store.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { Check } from '@crawlmouse/types/v2';
import { fixture } from '../fixtures';
import {
  COMPETITOR_REUSE_MS,
  competitorSiteId,
  competitorWork,
  type CompetitorDeps,
  type PlanRow,
} from './compare';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const HOUR = 60 * 60 * 1000;

const ROW: PlanRow = {
  checkStatus: 'finished',
  siteId: 'site-own',
  host: 'own.example',
  kept: true,
  staging: false,
  removed: false,
  paused: false,
  competitorHosts: ['rival-a.example', 'rival-b.example', 'rival-c.example'],
  competitorLimit: 3,
};

const ended = (): Check => structuredClone(fixture('bad-site').checks.at(-1)!);

function harness(over: Partial<CompetitorDeps> = {}, row: Partial<PlanRow> | null = {}) {
  const calls = {
    ensured: [] as string[],
    requested: [] as { siteId: string; trigger: string }[],
    written: [] as { checkId: string; hosts: string[] }[],
    global: 0,
    domain: [] as string[],
  };
  const latest = new Map<string, { checkId: string; finishedAt: string }>();
  const checks = new Map<string, Check>();
  let ids = 0;
  const deps: CompetitorDeps = {
    shown: () => true,
    paused: () => false,
    now: () => NOW,
    admit: async () => true,
    limits: {
      global: async () => (calls.global++, true),
      domain: async (d) => (calls.domain.push(d), true),
    },
    newId: () => `fresh-${++ids}`,
    request: async (siteId, checkId) => {
      calls.requested.push({ siteId, trigger: 'manual' });
      return checkId;
    },
    store: {
      planRow: async () => (row === null ? null : { ...ROW, ...row }),
      latestEnded: async (siteId) => latest.get(siteId) ?? null,
      ensureSite: async (siteId, host) => void calls.ensured.push(`${siteId}:${host}`),
      endedCheck: async (id) => checks.get(id) ?? null,
      endedOf: async (ids) => ids.filter((id) => checks.has(id) || id.startsWith('failed-')),
      writeCompetitors: async (checkId, snaps) => {
        calls.written.push({ checkId, hosts: snaps.map((s) => s.host) });
        return true;
      },
    },
    ...over,
  };
  return { work: competitorWork(deps), calls, latest, checks };
}

describe('plan', () => {
  it('names the first competitor_limit hosts, in the order the customer saved them', async () => {
    const { work } = harness({}, { competitorLimit: 2 });
    expect(await work.plan('check-own')).toEqual({ hosts: ['rival-a.example', 'rival-b.example'] });
  });

  it('drops the site’s own host and repeats, whatever their spelling', async () => {
    const { work } = harness(
      {},
      { competitorHosts: ['OWN.example', 'rival-a.example', 'Rival-A.example', 'rival-b.example'] },
    );
    expect(await work.plan('check-own')).toEqual({ hosts: ['rival-a.example', 'rival-b.example'] });
  });

  it.each<[string, Partial<PlanRow> | null, Partial<CompetitorDeps>]>([
    ['check_missing', null, {}],
    ['not_ended', { checkStatus: 'running' }, {}],
    ['unkept', { kept: false }, {}],
    ['staging', { staging: true }, {}],
    ['removed', { removed: true }, {}],
    ['paused', { paused: true }, {}],
    ['not_in_plan', { competitorLimit: 0 }, {}],
    ['no_competitors', { competitorHosts: [] }, {}],
    ['hidden', {}, { shown: () => false }],
  ])('skips with %s', async (skip, row, over) => {
    const { work } = harness(over, row);
    expect(await work.plan('check-own')).toEqual({ skip });
  });

  it('audits no competitor of a competitor: a site no account keeps never plans', async () => {
    const { work } = harness({}, { kept: false, competitorHosts: ['rival-a.example'] });
    expect(await work.plan('check-rival')).toEqual({ skip: 'unkept' });
  });
});

describe('start', () => {
  it('reuses a check of the host that ended under a day ago, and crawls nothing', async () => {
    const { work, calls, latest } = harness();
    const site = competitorSiteId('rival-a.example');
    latest.set(site, {
      checkId: 'old-1',
      finishedAt: new Date(NOW - COMPETITOR_REUSE_MS + HOUR).toISOString(),
    });
    expect(await work.start('rival-a.example')).toEqual({ checkId: 'old-1', reused: true });
    expect(calls.requested).toEqual([]);
    expect(calls.global).toBe(0);
  });

  it('crawls again once the last check is a day old, on the shared site row, with a fresh id', async () => {
    const { work, calls, latest } = harness();
    const site = competitorSiteId('rival-a.example');
    latest.set(site, {
      checkId: 'old-1',
      finishedAt: new Date(NOW - COMPETITOR_REUSE_MS).toISOString(),
    });
    expect(await work.start('rival-a.example')).toEqual({ checkId: 'fresh-1', reused: false });
    expect(calls.ensured).toEqual([`${site}:rival-a.example`]);
    expect(calls.requested).toEqual([{ siteId: site, trigger: 'manual' }]);
  });

  it('gives one host one site row, whoever names it', () => {
    expect(competitorSiteId('rival-a.example')).toBe(competitorSiteId('Rival-A.example'));
    expect(competitorSiteId('rival-a.example')).not.toBe(competitorSiteId('rival-b.example'));
  });

  it('counts a new crawl against the day’s ceiling and the host’s bucket, without www.', async () => {
    const { work, calls } = harness();
    await work.start('www.rival-a.example');
    expect(calls.global).toBe(1);
    expect(calls.domain).toEqual(['rival-a.example']);
  });

  it.each<[string, Partial<CompetitorDeps>]>([
    ['crawl_paused', { paused: () => true }],
    ['refused_host', { admit: async () => false }],
    ['capacity', { limits: { global: async () => false, domain: async () => true } }],
    ['domain_limit', { limits: { global: async () => true, domain: async () => false } }],
  ])('starts nothing with %s', async (skip, over) => {
    const { work, calls } = harness(over);
    expect(await work.start('rival-a.example')).toEqual({ skip });
    expect(calls.requested).toEqual([]);
    expect(calls.ensured).toEqual([]);
  });
});

describe('write', () => {
  it('writes one snapshot per ended check, in the plan’s order, and leaves out the rest', async () => {
    const { work, calls, checks } = harness();
    checks.set('c-a', ended());
    checks.set('c-c', ended());
    const out = await work.write('check-own', [
      { host: 'rival-a.example', checkId: 'c-a' },
      { host: 'rival-b.example', checkId: null },
      { host: 'rival-c.example', checkId: 'c-c' },
    ]);
    expect(out).toEqual({ written: 2 });
    expect(calls.written).toEqual([
      { checkId: 'check-own', hosts: ['rival-a.example', 'rival-c.example'] },
    ]);
  });

  it('writes nothing when no competitor check ended', async () => {
    const { work, calls } = harness();
    expect(
      await work.write('check-own', [{ host: 'rival-a.example', checkId: 'missing' }]),
    ).toEqual({ written: 0 });
    expect(calls.written).toEqual([]);
  });
});

describe('ended', () => {
  it('names the checks that have ended, so a failed one stops the wait too', async () => {
    const { work, checks } = harness();
    checks.set('c-a', ended());
    expect(await work.ended(['c-a', 'c-running', 'failed-1'])).toEqual(['c-a', 'failed-1']);
  });
});

describe('latest', () => {
  it("names the site's latest ended check, or none", async () => {
    const { work, latest } = harness();
    expect(await work.latest('site-own')).toBeNull();
    latest.set('site-own', { checkId: 'c-1', finishedAt: new Date(NOW).toISOString() });
    expect(await work.latest('site-own')).toBe('c-1');
  });
});
