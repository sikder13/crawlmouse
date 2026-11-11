/**
 * The states a live account reaches that no preview fixture holds (CC-26b D8): an account with no
 * site, a site whose first check has not ended, and the frame worn in the reader's own theme.
 * Each starts from bad-site and changes only what the state needs.
 */
import type { Check, FixtureDataset } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import { dashboardView } from './dashboard';
import { sitePage, siteView } from './site';

const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const OUTFITTER = '50000000-0000-4000-8000-000000000001';
const NAHLTECH = '50000000-0000-4000-8000-000000000002';
const bad = fixture('bad-site');

/** bad-site's account holding no site, nor any record of one. */
const noSites: FixtureDataset = {
  ...bad,
  sites: [],
  checks: [],
  page_results: [],
  link_edges: [],
  access_tests: [],
  fixes: [],
  fix_events: [],
  changes: [],
  alert_rules: bad.alert_rules.filter((r) => r.site_id === null),
  reports: [],
  usage_events: [],
  withheld: [],
};

describe('dashboardView with no site: day 0', () => {
  const v = dashboardView(noSites, { accountId: ACCOUNT, now: bad.as_of });

  it('asks for the site, with add-site as the one orange action and its address field', () => {
    expect(v.firstRun).toBe(true);
    expect(v.header.title).toBe('Add the site to watch');
    expect(v.header.line).toBe('Fri 30 Oct · 0 sites · trial ends Sat 7 Nov');
    expect(v.header.actions).toHaveLength(1);
    const add = v.header.actions[0]!;
    expect(add).toMatchObject({ route: '/api/sites', method: 'post', primary: true });
    expect(add.label).toBe('Add a site · 0 of 5 on Pro');
    expect(add.input).toEqual({
      name: 'host',
      type: 'text',
      label: 'Site address',
      placeholder: 'example.com',
    });
  });

  it('shows nothing measured: no strip, history, crawlers, fixes or set-up', () => {
    expect(v.strip).toBeNull();
    expect(v.changed).toEqual([]);
    expect(v.history).toBeNull();
    expect(v.crawlersByCheck).toBeNull();
    expect(v.crawlersNow).toBeNull();
    expect(v.topFixes).toBeNull();
    expect(v.setup).toBeNull();
    expect(v.sites.rows).toEqual([]);
    expect(v.sites.note).toBe('0 of 5 on Pro');
    expect(v.sites.foot).toMatch(/^Adding a site starts its first check/);
    expect(v.shell.nav.find((n) => n.label === 'Sites')!.count).toBe('0');
  });

  it('a Free account that never had a trial is offered one', () => {
    const free: FixtureDataset = {
      ...noSites,
      accounts: noSites.accounts.map((a) => ({
        ...a,
        state: 'free',
        trial_ends_at: null,
        state_history: [{ state: 'free', since: a.state_history[0]!.since }],
        limits: { ...a.limits, sites: 1 },
      })),
    };
    const f = dashboardView(free, { accountId: ACCOUNT, now: bad.as_of });
    expect(f.header.line).toBe('Fri 30 Oct · 0 sites');
    expect(f.header.actions[0]!.label).toBe('Add a site · 0 of 1 on Free');
    expect(f.startPro?.start.route).toBe('/api/billing/pro-trial/start');
  });
});

describe('sitePage: a site whose first check has not ended', () => {
  const nahltechChecks = bad.checks
    .filter((c) => c.site_id === NAHLTECH)
    .sort((a, b) => Date.parse(a.queued_at) - Date.parse(b.queued_at));
  const first = nahltechChecks[0]!;
  const mid = new Date((Date.parse(first.started_at!) + Date.parse(first.finished_at!)) / 2);

  it('reads the check as running at a moment inside it, linking to the crawl screen', () => {
    const p = sitePage(bad, { accountId: ACCOUNT, now: mid.toISOString() }, NAHLTECH);
    expect(p.kind).toBe('first_check');
    if (p.kind !== 'first_check') return;
    expect(p.first.title).toBe('nahltech.com');
    expect(p.first.state).toBe('running');
    expect(p.first.line).toMatch(/ · First check running$/);
    expect(p.first.actions).toHaveLength(1);
    expect(p.first.actions[0]).toMatchObject({
      href: `/audit/${first.id}`,
      primary: true,
      label: 'Watch the check',
    });
  });

  it('a running check with progress says how many pages it has read', () => {
    const running: Check = {
      ...first,
      status: 'running',
      finished_at: null,
      coverage: null,
      technical_seo: null,
      ai_readability: null,
      progress: {
        steps: [{ phase: 'crawl', state: 'running' }],
        pages_crawled: 1234,
        pages_estimated: null,
        links_found: 9,
        elapsed_ms: 1000,
        recent_fetches: [],
      },
    } as Check;
    const d = { ...bad, checks: bad.checks.map((c) => (c.id === first.id ? running : c)) };
    const p = sitePage(d, { accountId: ACCOUNT, now: mid.toISOString() }, NAHLTECH);
    expect(p.kind === 'first_check' && p.first.line).toMatch(
      / · First check running · 1,234 pages read so far$/,
    );
  });

  it('before the check starts it is queued; a failed first check offers to run it again', () => {
    const before = new Date(Date.parse(first.started_at!) - 1).toISOString();
    const q = sitePage(bad, { accountId: ACCOUNT, now: before }, NAHLTECH);
    expect(q.kind === 'first_check' && q.first.state).toBe('queued');

    const failed: Check = {
      ...first,
      status: 'failed',
      failure_reason: 'unreachable',
      coverage: null,
      technical_seo: null,
      ai_readability: null,
    } as Check;
    const d = {
      ...bad,
      checks: bad.checks
        .filter((c) => c.site_id !== NAHLTECH || c.id === first.id)
        .map((c) => (c.id === first.id ? failed : c)),
    };
    const f = sitePage(d, { accountId: ACCOUNT, now: bad.as_of }, NAHLTECH);
    expect(f.kind).toBe('first_check');
    if (f.kind !== 'first_check') return;
    expect(f.first.state).toBe('failed');
    expect(f.first.actions[0]).toMatchObject({
      route: '/api/sites/[id]/checks',
      href: `/api/sites/${NAHLTECH}/checks`,
      primary: true,
    });
  });

  it('a site with a result reads as the site view itself', () => {
    const p = sitePage(bad, { accountId: ACCOUNT, now: bad.as_of }, OUTFITTER);
    expect(p).toEqual({
      kind: 'site',
      site: siteView(bad, { accountId: ACCOUNT, now: bad.as_of }, OUTFITTER),
    });
  });

  it('a site that is not the viewer’s throws, as siteView does', () => {
    expect(() =>
      sitePage(bad, { accountId: ACCOUNT, now: bad.as_of }, '50000000-0000-4000-8000-0000000000ff'),
    ).toThrow(/not the viewer/);
  });
});

describe('the frame wears the reader’s own theme', () => {
  const DEV = 'e0000000-0000-4000-8000-0000000000d1';
  const withDev: FixtureDataset = {
    ...bad,
    seats: [
      ...bad.seats,
      {
        ...bad.seats[0]!,
        id: DEV,
        email: 'dev@example.com',
        role: 'developer',
        theme: 'dark',
      },
    ],
  };

  it('a developer reads their dark theme, the owner keeps theirs', () => {
    const asDev = dashboardView(withDev, { accountId: ACCOUNT, seatId: DEV, now: bad.as_of });
    expect(asDev.shell.theme).toBe('dark');
    const asOwner = dashboardView(withDev, {
      accountId: ACCOUNT,
      seatId: bad.seats[0]!.id,
      now: bad.as_of,
    });
    expect(asOwner.shell.theme).toBe('system');
  });

  it('a preview names no seat and reads as the owner', () => {
    expect(dashboardView(withDev, { accountId: ACCOUNT, now: bad.as_of }).shell.theme).toBe(
      'system',
    );
  });
});

describe('the site page’s fix rows', () => {
  const v = siteView(bad, { accountId: ACCOUNT, now: bad.as_of }, OUTFITTER);

  it('a fix still to do that the tier opens carries Mark done, posting to its route', () => {
    const open = v.fixes.rows.filter((r) => r.markDone !== null);
    expect(open.length).toBeGreaterThan(0);
    for (const r of open) {
      expect(r.markDone).toMatchObject({
        label: 'Mark done',
        route: '/api/fixes/[id]/done',
        href: `/api/fixes/${r.key}/done`,
        method: 'post',
        primary: false,
        context: `fix ${r.number}`,
      });
    }
  });

  it('a fix not to do, or one the tier does not open, carries none', () => {
    const status = new Map(bad.fixes.map((f) => [f.id, f.status]));
    const todo = new Set(['open', 'reopened', 'unable_to_verify']);
    const none = v.fixes.rows.filter((r) => !todo.has(status.get(r.key)!) || r.pro);
    expect(none.length).toBeGreaterThan(0);
    for (const r of v.fixes.rows) {
      expect(r.markDone === null).toBe(!todo.has(status.get(r.key)!) || r.pro);
    }
  });
});
