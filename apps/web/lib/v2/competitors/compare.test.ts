/**
 * Row 18: which finished checks audit their site's competitors, how each competitor's check is
 * started, waited on or reused, and what is written back. The store, the pipeline's request and the
 * limits are fakes here; the SQL is tested against PGlite in store.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { Check, CompetitorSnapshot } from '@crawlmouse/types/v2';
import { findCheck, fixture } from '../fixtures';
import { FIRST_AUDIT } from '../view/segment/test-helpers';
import {
  COMPETITOR_HOLD_MS,
  COMPETITOR_REUSE_MS,
  competitorSiteId,
  competitorWork,
  type CompetitorDeps,
  type CompetitorState,
  type PlanRow,
} from './compare';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

const ROW: PlanRow = {
  checkStatus: 'finished',
  siteId: 'site-own',
  host: 'own.example',
  accountId: 'acct-1',
  staging: false,
  removed: false,
  paused: false,
  competitorHosts: ['rival-a.example', 'rival-b.example', 'rival-c.example'],
  competitorLimit: 3,
  siteLimit: 25,
};

const ended = (): Check => structuredClone(findCheck(fixture('bad-site'), FIRST_AUDIT['bad-site']));

function harness(over: Partial<CompetitorDeps> = {}, row: Partial<PlanRow> | null = {}) {
  const calls = {
    ensured: [] as string[],
    requested: [] as string[],
    written: [] as { checkId: string; hosts: string[] }[],
    global: 0,
    account: [] as [string, number][],
    domain: [] as string[],
  };
  const states = new Map<string, CompetitorState>();
  const checks = new Map<string, Check>();
  const latest = new Map<string, string>();
  let current: PlanRow | null = row === null ? null : { ...ROW, ...row };
  let ids = 0;
  const deps: CompetitorDeps = {
    shown: () => true,
    paused: () => false,
    now: () => NOW,
    admit: async () => true,
    limits: {
      global: async () => (calls.global++, true),
      account: async (id, cap) => (calls.account.push([id, cap]), true),
      domain: async (d) => (calls.domain.push(d), true),
    },
    newId: () => `fresh-${++ids}`,
    request: async (siteId, checkId) => {
      calls.requested.push(siteId);
      return checkId;
    },
    store: {
      planRow: async () => current,
      latestEnded: async (siteId) => {
        const id = latest.get(siteId);
        return id ? { checkId: id, finishedAt: iso(NOW) } : null;
      },
      competitorState: async (siteId) => states.get(siteId) ?? null,
      ensureSite: async (siteId, host) => void calls.ensured.push(`${siteId}:${host}`),
      endedCheck: async (id) => checks.get(id) ?? null,
      endedOf: async (list) => list.filter((id) => checks.has(id)),
      writeCompetitors: async (checkId, snaps) => {
        calls.written.push({ checkId, hosts: snaps.map((s) => s.host) });
        return true;
      },
    },
    ...over,
  };
  return {
    work: competitorWork(deps),
    calls,
    states,
    checks,
    latest,
    setRow: (r: Partial<PlanRow>) => (current = { ...ROW, ...r }),
  };
}

describe('plan', () => {
  it('names the first competitor_limit hosts in the saved order, with the account and its cap', async () => {
    const { work } = harness({}, { competitorLimit: 2, siteLimit: 5 });
    expect(await work.plan('check-own')).toEqual({
      hosts: ['rival-a.example', 'rival-b.example'],
      accountId: 'acct-1',
      cap: 10,
    });
  });

  it('drops the site’s own host and repeats, by case and by www.', async () => {
    const { work } = harness(
      {},
      {
        host: 'www.own.example',
        competitorHosts: [
          'OWN.example',
          'own.example',
          'rival-a.example',
          'Rival-A.example',
          'www.rival-a.example',
          'rival-b.example',
        ],
      },
    );
    expect(await work.plan('check-own')).toMatchObject({
      hosts: ['rival-a.example', 'rival-b.example'],
    });
  });

  it.each<[string, Partial<PlanRow> | null, Partial<CompetitorDeps>]>([
    ['check_missing', null, {}],
    ['not_ended', { checkStatus: 'running' }, {}],
    ['unkept', { accountId: null }, {}],
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
    const { work } = harness({}, { accountId: null, competitorHosts: ['rival-a.example'] });
    expect(await work.plan('check-rival')).toEqual({ skip: 'unkept' });
  });
});

describe('start', () => {
  const site = competitorSiteId('rival-a.example');
  const endedAt = (finishedAgo: number, expiresIn: number | null): CompetitorState => ({
    kept: false,
    live: null,
    ended: {
      checkId: 'old-1',
      finishedAt: iso(NOW - finishedAgo),
      expiresAt: expiresIn === null ? null : iso(NOW + expiresIn),
    },
  });

  it('reuses a check that ended under a day ago and is kept past the wait, and crawls nothing', async () => {
    const { work, calls, states } = harness();
    states.set(site, endedAt(COMPETITOR_REUSE_MS - HOUR, COMPETITOR_HOLD_MS + HOUR));
    expect(await work.start('rival-a.example', 'acct-1', 3)).toEqual({
      checkId: 'old-1',
      reused: true,
    });
    expect(calls.requested).toEqual([]);
    expect(calls.global).toBe(0);
  });

  it('waits on a check of the host already under way, and starts none', async () => {
    const { work, calls, states } = harness();
    states.set(site, { kept: false, live: 'live-1', ended: null });
    expect(await work.start('rival-a.example', 'acct-1', 3)).toEqual({
      checkId: 'live-1',
      reused: false,
    });
    expect(calls.requested).toEqual([]);
  });

  it.each([
    ['a day old', COMPETITOR_REUSE_MS, COMPETITOR_HOLD_MS + HOUR],
    ['due to expire during the wait', HOUR, COMPETITOR_HOLD_MS],
  ])(
    'crawls again when the last check is %s, on the shared row, with a fresh id',
    async (_, ago, hold) => {
      const { work, calls, states } = harness();
      states.set(site, endedAt(ago, hold));
      expect(await work.start('rival-a.example', 'acct-1', 3)).toEqual({
        checkId: 'fresh-1',
        reused: false,
      });
      expect(calls.ensured).toEqual([`${site}:rival-a.example`]);
      expect(calls.requested).toEqual([site]);
    },
  );

  it('never reads or crawls a row an account has come to keep', async () => {
    const { work, calls, states } = harness();
    states.set(site, { ...endedAt(HOUR, null), kept: true, live: 'live-1' });
    expect(await work.start('rival-a.example', 'acct-1', 3)).toEqual({ skip: 'site_kept' });
    expect(calls.requested).toEqual([]);
  });

  it('gives one host one site row, by case and by www.', () => {
    expect(competitorSiteId('Rival-A.example')).toBe(site);
    expect(competitorSiteId('www.rival-a.example')).toBe(site);
    expect(competitorSiteId('rival-b.example')).not.toBe(site);
  });

  it('counts a new crawl against the day’s ceiling, the account’s bucket and the host’s, without www.', async () => {
    const { work, calls } = harness();
    await work.start('www.rival-a.example', 'acct-1', 75);
    expect(calls.global).toBe(1);
    expect(calls.account).toEqual([['acct-1', 75]]);
    expect(calls.domain).toEqual(['rival-a.example']);
  });

  const limits = (g: boolean, a: boolean, d: boolean): Partial<CompetitorDeps> => ({
    limits: { global: async () => g, account: async () => a, domain: async () => d },
  });
  it.each<[string, Partial<CompetitorDeps>]>([
    ['crawl_paused', { paused: () => true }],
    ['refused_host', { admit: async () => false }],
    ['capacity', limits(false, true, true)],
    ['account_limit', limits(true, false, true)],
    ['domain_limit', limits(true, true, false)],
  ])('starts nothing with %s', async (skip, over) => {
    const { work, calls } = harness(over);
    expect(await work.start('rival-a.example', 'acct-1', 3)).toEqual({ skip });
    expect(calls.requested).toEqual([]);
    expect(calls.ensured).toEqual([]);
  });
});

describe('write', () => {
  const snap = (host: string): CompetitorSnapshot => ({
    host,
    crawlers_with_access: 1,
    crawlers_tested: 6,
    text_share: null,
    product_schema: null,
    technical_seo: null,
    ai_readability: null,
    signals_present: 0,
  });

  it('writes one snapshot per ended check, in the listed order, and leaves out the rest', async () => {
    const { work, calls, checks } = harness();
    checks.set('c-a', ended());
    checks.set('c-c', ended());
    const out = await work.write('check-own', [
      { host: 'rival-c.example', checkId: 'c-c' },
      { host: 'rival-b.example', checkId: null },
      { host: 'rival-a.example', checkId: 'c-a' },
    ]);
    expect(out).toEqual({ written: 2 });
    expect(calls.written).toEqual([
      { checkId: 'check-own', hosts: ['rival-a.example', 'rival-c.example'] },
    ]);
  });

  it('leaves out a host the member removed since the plan', async () => {
    const { work, calls, checks, setRow } = harness();
    checks.set('c-a', ended());
    checks.set('c-b', ended());
    setRow({ competitorHosts: ['rival-b.example'] });
    await work.write('check-own', [
      { host: 'rival-a.example', checkId: 'c-a' },
      { host: 'rival-b.example', checkId: 'c-b' },
    ]);
    expect(calls.written).toEqual([{ checkId: 'check-own', hosts: ['rival-b.example'] }]);
  });

  it('keeps a listed host’s snapshot when this run has none for it, and clears a removed one', async () => {
    const { work, calls, checks, setRow } = harness();
    const own = ended();
    own.competitors = [snap('rival-a.example'), snap('gone.example')];
    checks.set('check-own', own);
    setRow({ competitorHosts: ['rival-a.example', 'rival-b.example'] });
    expect(await work.write('check-own', [{ host: 'rival-b.example', checkId: null }])).toEqual({
      written: 0,
    });
    expect(calls.written).toEqual([{ checkId: 'check-own', hosts: ['rival-a.example'] }]);
  });

  it('writes nothing when nothing changed', async () => {
    const { work, calls } = harness();
    expect(
      await work.write('check-own', [{ host: 'rival-a.example', checkId: 'missing' }]),
    ).toEqual({ written: 0 });
    expect(calls.written).toEqual([]);
  });
});

describe('latest', () => {
  it("names the site's latest ended check, or none", async () => {
    const { work, latest } = harness();
    expect(await work.latest('site-own')).toBeNull();
    latest.set('site-own', 'c-1');
    expect(await work.latest('site-own')).toBe('c-1');
  });
});
