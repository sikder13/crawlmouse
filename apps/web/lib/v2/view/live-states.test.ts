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
    expect(add.inputs).toEqual([
      {
        kind: 'text',
        name: 'url',
        type: 'text',
        label: 'Site address',
        placeholder: 'example.com',
        required: true,
      },
    ]);
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
        steps: [{ phase: 'crawl', state: 'now' }],
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

  const status = new Map(bad.fixes.map((f) => [f.id, f.status]));
  const todo = new Set(['open', 'reopened', 'unable_to_verify']);

  it('on a paid tier every fix still to do carries Mark done, those past the Free three too', () => {
    // bad-site's account is on the Pro trial: every fix is open to it.
    expect(v.fixes.rows.some((r) => r.pro && todo.has(status.get(r.key)!))).toBe(true);
    for (const r of v.fixes.rows) expect(r.markDone !== null).toBe(todo.has(status.get(r.key)!));
  });

  it('on Free a fix past the Free three carries none, and the Free three do', () => {
    const free: FixtureDataset = {
      ...bad,
      accounts: bad.accounts.map((a) => ({
        ...a,
        state: 'free',
        trial_ends_at: null,
        state_history: [{ state: 'free', since: a.state_history[0]!.since }],
      })),
    };
    const f = siteView(free, { accountId: ACCOUNT, now: bad.as_of }, OUTFITTER);
    expect(f.fixes.rows.some((r) => r.pro && todo.has(status.get(r.key)!))).toBe(true);
    expect(f.fixes.rows.some((r) => !r.pro && todo.has(status.get(r.key)!))).toBe(true);
    for (const r of f.fixes.rows)
      expect(r.markDone !== null).toBe(todo.has(status.get(r.key)!) && !r.pro);
  });
});

describe('a fix marked done and not yet measured (owner ruling Q4)', () => {
  it('says the next check confirms it or reopens it, and offers no undo or second mark', () => {
    const base = siteView(bad, { accountId: ACCOUNT, now: bad.as_of }, OUTFITTER);
    const row = base.fixes.rows.find((r) => r.markDone !== null)!;
    const at = new Date(Date.parse(bad.as_of) - 3_600_000).toISOString();
    const marked: FixtureDataset = {
      ...bad,
      fix_events: [
        ...bad.fix_events,
        {
          id: 'f0000000-0000-4000-8000-0000000000aa',
          fix_id: row.key,
          at,
          kind: 'marked_done',
          by_seat_id: bad.seats[0]!.id,
        },
      ],
    };
    const v = siteView(marked, { accountId: ACCOUNT, now: bad.as_of }, OUTFITTER);
    const after = v.fixes.rows.find((r) => r.key === row.key)!;
    expect(after.note).toMatch(/^marked done \w+; the next check confirms the fix or reopens it$/);
    expect(after.markDone).toBeNull();
    const labels = JSON.stringify(v).toLowerCase();
    expect(labels).not.toMatch(/undo|unmark|reopen this/);
  });
});

describe('the controls a seat can use (round 1, item 7)', () => {
  const seat = (
    role: 'owner' | 'account_manager' | 'developer',
    scope: 'all' | string[] = 'all',
  ) => ({
    ...bad.seats[0]!,
    id: `e0000000-0000-4000-8000-0000000000${role === 'owner' ? 'a1' : role === 'developer' ? 'a2' : 'a3'}`,
    email: `${role}@example.com`,
    role,
    client_scope: scope,
  });
  const withSeat = (s: ReturnType<typeof seat>): FixtureDataset => ({
    ...bad,
    seats: [...bad.seats, s],
  });
  const free: FixtureDataset = {
    ...bad,
    accounts: bad.accounts.map((a) => ({
      ...a,
      state: 'free',
      trial_ends_at: null,
      state_history: [{ state: 'free', since: a.state_history[0]!.since }],
    })),
  };
  const routes = (actions: { route: string }[]) => actions.map((a) => a.route);

  it('a developer is offered no add, edit, remove or trial start', () => {
    const dev = seat('developer');
    const viewer = { accountId: ACCOUNT, seatId: dev.id, now: bad.as_of };
    expect(routes(dashboardView(withSeat(dev), viewer).header.actions)).not.toContain('/api/sites');
    const s = siteView(withSeat(dev), viewer, OUTFITTER);
    expect(s.settings.rows.filter((r) => r.action?.route === '/api/sites/[id]')).toEqual([]);
    expect(s.settings.rows.map((r) => r.label)).not.toContain('Remove this site');
    expect(dashboardView({ ...free, seats: [...free.seats, dev] }, viewer).startPro).toBeNull();
  });

  it('an account manager edits and removes; scoped to some clients, they cannot add', () => {
    const all = seat('account_manager');
    const scoped = seat('account_manager', [OUTFITTER]);
    const as = (s: typeof all) => ({ accountId: ACCOUNT, seatId: s.id, now: bad.as_of });
    expect(routes(dashboardView(withSeat(all), as(all)).header.actions)).toContain('/api/sites');
    expect(routes(dashboardView(withSeat(scoped), as(scoped)).header.actions)).not.toContain(
      '/api/sites',
    );
    const s = siteView(withSeat(scoped), as(scoped), OUTFITTER);
    expect(s.settings.rows.find((r) => r.label === 'Schedule')!.action?.route).toBe(
      '/api/sites/[id]',
    );
    expect(s.settings.rows.map((r) => r.label)).toContain('Remove this site');
    // The trial is the owner's.
    expect(dashboardView({ ...free, seats: [...free.seats, all] }, as(all)).startPro).toBeNull();
  });

  it('the owner is offered all of them', () => {
    const owner = { accountId: ACCOUNT, seatId: bad.seats[0]!.id, now: bad.as_of };
    expect(routes(dashboardView(bad, owner).header.actions)).toContain('/api/sites');
    expect(dashboardView(free, owner).startPro).not.toBeNull();
  });
});

describe('a running first check', () => {
  it('says "1 page read", not "1 pages"', () => {
    const first = bad.checks
      .filter((c) => c.site_id === NAHLTECH)
      .sort((a, b) => Date.parse(a.queued_at) - Date.parse(b.queued_at))[0]!;
    const mid = new Date((Date.parse(first.started_at!) + Date.parse(first.finished_at!)) / 2);
    const one: Check = {
      ...first,
      status: 'running',
      finished_at: null,
      coverage: null,
      technical_seo: null,
      ai_readability: null,
      progress: {
        steps: [{ phase: 'crawl', state: 'now' }],
        pages_crawled: 1,
        pages_estimated: null,
        links_found: 0,
        elapsed_ms: 10,
        recent_fetches: [],
      },
    } as Check;
    const d = { ...bad, checks: bad.checks.map((c) => (c.id === first.id ? one : c)) };
    const p = sitePage(d, { accountId: ACCOUNT, now: mid.toISOString() }, NAHLTECH);
    expect(p.kind === 'first_check' && p.first.line).toMatch(/ · 1 page read so far$/);
  });
});
