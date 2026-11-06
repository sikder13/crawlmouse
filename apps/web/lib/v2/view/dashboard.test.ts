/**
 * The dashboard's view model against values worked out by hand from the fixtures (the comments give
 * the arithmetic), so a test cannot pass by agreeing with the code it checks.
 */
import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import { firstRunNow } from './account';
import { ACCOUNT_ACTIONS, dashboardView, type DashboardView } from './dashboard';
import { CLEAN_VIEWER } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';

const BAD_ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const C9 = 'a0000000-0000-4000-8000-0000000000c9';
const bad = fixture('bad-site');

const home = () => dashboardView(bad, { accountId: BAD_ACCOUNT, now: bad.as_of });
const day0 = () =>
  dashboardView(bad, { accountId: BAD_ACCOUNT, now: firstRunNow(bad, { accountId: BAD_ACCOUNT }) });

/** headline = rows = cells, the reconciliation D5 asks for. */
function reconciles(v: DashboardView) {
  const cells = v.sites.rows.reduce((n, r) => n + r.since.opened + r.since.resolved, 0);
  expect(cells).toBe(v.changed.length);
  if (v.strip) expect(v.strip.opened.count + v.strip.resolved.count).toBe(v.changed.length);
  expect(v.shell.nav.find((n) => n.label === 'Changes')!.count).toBe(
    v.changed.length ? `${v.changed.length} new` : null,
  );
}

describe('Dashboard home, bad-site at as_of (Fri 30 Oct 06:05 in Indiana)', () => {
  const v = home();

  it('names Thursday’s check and the account’s day in its zone', () => {
    expect(v.firstRun).toBe(false);
    expect(v.header.title).toBe("Since Thursday's check");
    // last check: 10:02Z = 06:02 EDT; next: Fri 6 Nov 06:00 EST; trial: 8 Nov 02:41Z = Sat 7 Nov.
    expect(v.header.line).toBe(
      'Fri 30 Oct · 5 sites · last check today 06:02 · next weekly check Fri 6 Nov around 06:00 · trial ends Sat 7 Nov',
    );
  });

  it('means both grades over the five sites: 743 / 10 = 74.3, and 758 / 10 = 75.8 at Thursday’s check', () => {
    // now: 79+22 · 84+93 · 74+78 · 73+66 · 86+88; Thursday: 80+41 · 79+93 · 74+78 · 73+66 · 86+88.
    expect(v.strip!.health.value).toBe('74');
    expect(v.strip!.health.delta).toBe('−2 since Thu');
    expect(v.strip!.health.excluded).toBeNull();
  });

  it('counts change records per site window: two opened, one resolved, three other', () => {
    // site 1: changes 1, 2 opened, 3, 4 changed; site 2: 5 resolved; site 3: 8 baseline.
    expect(v.strip!.opened).toMatchObject({ count: 2, noun: 'crawlers blocked' });
    expect(v.strip!.resolved).toMatchObject({ count: 1, noun: 'orphan pages' });
    expect(v.strip!.other.count).toBe(3);
    expect(v.changed.map((c) => c.title)).toEqual([
      'Claude-SearchBot is now blocked on example-outfitter.com',
      'ClaudeBot is now blocked on example-outfitter.com',
      'nahltech.com: 3 orphan pages now linked',
    ]);
    reconciles(v);
  });

  it('writes each change’s line from its own fields and its check’s grade moves (Q12)', () => {
    expect(v.changed[0]!.line).toBe(
      'Detected Fri 06:02 · robots.txt changed Thu 19:40 · 214 pages · this check: AI readability D → F · sent to Slack #seo',
    );
    expect(v.changed[2]!.line).toBe('Fri 06:01 · Technical SEO B → B+ · from your fix list');
    // Fix 0 is open, so its change offers it; ClaudeBot's change has no fix; fix 20 is resolved.
    expect(v.changed.map((c) => c.actions.map((a) => a.label))).toEqual([
      ['Diff', 'Copy fix', 'Email to my developer'],
      ['Diff'],
      ['Diff'],
    ]);
  });

  it('lists the sites with their result checks, and counts primary sites against the limit (Q10)', () => {
    expect(
      v.sites.rows.map((r) => [r.host, r.seo?.letter, r.seo?.score, r.ai?.letter, r.ai?.score]),
    ).toEqual([
      ['example-outfitter.com', 'B', 79, 'F', 22],
      ['nahltech.com', 'B+', 84, 'A', 93],
      ['redbirdaviation.com', 'B-', 74, 'B', 78],
      ['drivepei.ca', 'B-', 73, 'C', 66],
      ['staging.example-outfitter.dev', 'A-', 86, 'A-', 88],
    ]);
    expect(v.sites.rows.map((r) => r.lastCheck)).toEqual([
      'Fri 06:02',
      'Fri 06:01',
      'Fri 06:01',
      'Fri 06:01 · check queued',
      'Thu 18:23',
    ]);
    expect(v.sites.rows.map((r) => r.schedule)).toEqual([
      'weekly, Fri',
      'weekly, Fri',
      'weekly, Fri',
      'weekly, Fri',
      'on each deploy',
    ]);
    expect(v.sites.note).toBe('4 of 5 on Pro');
    expect(v.sites.upsell).toBeNull();
  });

  it('draws the primary site’s six checks in the account’s dates', () => {
    const h = v.history!;
    expect(h.title).toBe('example-outfitter.com · 6 checks since 24 Oct, 4 of them run by you');
    expect(h.points.map((p) => p.label)).toEqual(['24 Oct', '26', '27', '28', 'Thu 29', 'Fri 30']);
    expect(h.points.map((p) => p.seo)).toEqual([79, 79, 80, 80, 80, 79]);
    expect(h.points.map((p) => p.ai)).toEqual([41, 41, 41, 41, 41, 22]);
    // AI readability is 41 at the first five checks; at the sixth, robots.txt blocked two crawlers.
    expect(h.flatNote).toBe('AI readability · 41 since the first audit');
    expect(h.marker).toEqual({ index: 5, label: 'Claude-SearchBot and ClaudeBot blocked · 22' });
    expect(h.summary).toBe(
      'Technical SEO 79 at checks 1 to 2, then 80 at checks 3 to 5, then 79 at check 6; AI readability 41 at checks 1 to 5, then 22 at check 6',
    );
  });

  it('shows crawler access by check for the six AI crawlers, and now for all eight', () => {
    expect(v.crawlersByCheck!.map((r) => r.ua)).toEqual([
      'OAI-SearchBot',
      'ChatGPT-User',
      'PerplexityBot',
      'Claude-SearchBot',
      'GPTBot',
      'ClaudeBot',
    ]);
    const claude = v.crawlersByCheck!.find((r) => r.ua === 'ClaudeBot')!;
    expect(claude.verdicts).toEqual([
      'allowed_thin',
      'allowed_thin',
      'allowed_thin',
      'allowed_thin',
      'allowed_thin',
      'disallowed_by_robots',
    ]);
    expect(v.crawlersNow!.map((r) => r.ua)).toHaveLength(8);
  });

  it('lists what is left to set up from the Pro gates: two of five (FACTS l.57)', () => {
    expect(v.setup!.title).toBe('Two things left to set up');
    expect(v.setup!.items.map((i) => i.done)).toEqual([true, true, false, true, false]);
  });

  it('carries the trial card that follows the first run', () => {
    // Fri 30 Oct to Sat 7 Nov in Indiana: eight dates (Q4).
    expect(v.shell.trial).toMatchObject({
      title: 'Pro, trial · ends Sat 7 Nov',
      left: '8 days left',
      billing: null,
    });
    expect(v.shell.trial!.keep!.label).toBe('Keep Pro, $19 a month');
    expect(v.shell.nav.find((n) => n.label === 'Sites')!.count).toBe('5');
  });

  it('makes running a check its one orange action', () => {
    expect(v.header.actions.filter((a) => a.primary).map((a) => a.label)).toEqual([
      'Run a check now',
    ]);
  });
});

describe('Dashboard, day 0: the moment the account begins', () => {
  const v = day0();

  it('is the first run: one site, one audit, nothing to compare', () => {
    expect(v.firstRun).toBe(true);
    expect(v.strip).toBeNull();
    expect(v.changed).toEqual([]);
    expect(v.header.title).toBe('example-outfitter.com is kept.');
    expect(v.header.line).toBe(
      'Sat 24 Oct · 1 site · audited 22:34 · next weekly check Fri 30 Oct around 06:00 · trial ends Sat 7 Nov',
    );
    expect(v.sites.rows.map((r) => r.sinceLabel)).toEqual(['first audit · 13 fixes']);
    reconciles(v);
  });

  it('starts with the three largest fixes, and says how many more there are', () => {
    expect(v.topFixes!.rows.map((r) => [r.number, r.effect])).toEqual([
      [1, '+24 AI'],
      [2, '+22 AI'],
      [3, '+4 SEO'],
    ]);
    expect(v.topFixes!.foot).toBe(
      'Each fix page has "Mark done and re-check now", about 2 minutes. The other 10 are open for 14 days.',
    );
    expect(v.header.actions.filter((a) => a.primary).map((a) => a.label)).toEqual([
      'Start with fix 1 · about 10 minutes',
    ]);
  });

  it('dates the reminder three days before the trial ends, in the account’s zone (A8, Q4)', () => {
    // 8 Nov 02:41Z − 3 days = 5 Nov 02:41Z = Wed 4 Nov 21:41 EST.
    expect(v.threeKinds!.body).toContain(
      'one reminder on Wed 4 Nov, three days before the trial ends.',
    );
    expect(v.shell.trial).toMatchObject({ left: '14 days left', keep: null });
    expect(v.shell.trial!.billing).not.toBeNull();
  });
});

describe('Dashboard, withheld: challenged-site as Northwind Digital (past_due, Agency in grace)', () => {
  const c = fixture('challenged-site');
  const v = dashboardView(c, { accountId: C9, now: c.as_of });

  it('means harborlight’s two grades, (91 + 89) / 2 = 90, and names the site it left out', () => {
    expect(v.strip!.health.value).toBe('90');
    expect(v.strip!.health.excluded).toBe('1 site excluded: AI readability withheld');
    expect(v.shell.nav.find((n) => n.label === 'Sites')!.count).toBe('2');
    expect(v.shell.trial).toBeNull();
    expect(v.sites.note).toBe('2 of 25 on Agency');
    reconciles(v);
  });
});

describe('Dashboard, clean: an unkept audit adopted by a free account that never had a trial', () => {
  const c = fixture('clean-site');
  const v = dashboardView(c, CLEAN_VIEWER);

  it('offers 14 days of Pro once (H5), and nothing that Pro alone would set up', () => {
    expect(v.startPro).not.toBeNull();
    expect(v.setup).toBeNull();
    expect(v.shell.trial).toBeNull();
    expect(v.sites.note).toBe('1 of 1 on Free');
    reconciles(v);
  });
});

describe('the actions CC-26b wires', () => {
  it('names a route for every action the screens offer', () => {
    for (const v of [home(), day0()]) {
      const actions = [
        ...v.header.actions,
        ...v.changed.flatMap((c) => c.actions),
        ...(v.setup?.items.flatMap((i) => (i.action ? [i.action] : [])) ?? []),
      ];
      const known = new Set(Object.values(ACCOUNT_ACTIONS).map((a) => a.route));
      for (const a of actions) expect(known).toContain(a.route);
    }
  });
});
