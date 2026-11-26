/**
 * F-335 (QA's production re-walk, 25 Nov): #216 took Integrations off a developer's rail on seven
 * account pages and missed /settings, whose viewer names no seat (`readSettingsPage`). The rail read
 * the role from the viewer, and a viewer with no seat reads as the owner. It now reads the role the
 * page passes to `accountShellView`, which every page must pass and Billing and Keep already use.
 *
 * #216's test passed a seat in every case, so it never varied what the bug keyed on. This file does,
 * three ways:
 * - the rule: every role, against a viewer naming no seat and each seat, on every rail link;
 * - every page that draws the account rail, built for a developer, in each viewer shape its role
 *   can arrive with;
 * - the list of those pages against the source: every `accountShellView(` call outside tests must
 *   be one of them, so a page added later fails here until it is swept.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SeatRole } from '../account/profile';
import { fixture } from '../fixtures';
import { readerRole, viewAt } from './account';
import { ACCOUNT_NAV, AGENCY_NAV, type RailLabel } from './account-actions';
import { accountShellView, type ShellView } from './account-shell';
import { alertsView } from './alerts';
import { changesLogView } from './changes-log';
import { dashboardView } from './dashboard';
import { integrationsView } from './integrations';
import { reportsView } from './reports';
import { seatsView } from './seats';
import { deleteStepView, settingsNotYoursView, settingsView } from './settings';
import { sitePage } from './site';
import { trialEndView, trialEndedView } from './trial-end';

// bad-site's Pro trial account, with a manager's and a developer's seat beside its owner's.
const base = fixture('bad-site');
const ACCOUNT = base.accounts[0]!.id;
const OWNER = base.seats[0]!;
const SEATS = {
  owner: OWNER.id,
  account_manager: 'e0000000-0000-4000-8000-0000000000f1',
  developer: 'e0000000-0000-4000-8000-0000000000f2',
} as const satisfies Record<SeatRole, string>;
const d = structuredClone(base);
d.seats.push(
  { ...structuredClone(OWNER), id: SEATS.account_manager, role: 'account_manager' },
  { ...structuredClone(OWNER), id: SEATS.developer, role: 'developer' },
);
const ROLES: readonly SeatRole[] = ['owner', 'account_manager', 'developer'];

/** A viewer naming `seat`, or none at all: the shape Settings, Plan, Delete and Trial-ended give. */
const viewer = (seat: SeatRole | null, now = d.as_of) =>
  seat === null ? { accountId: ACCOUNT, now } : { accountId: ACCOUNT, seatId: SEATS[seat], now };

const labels = (shell: ShellView) => shell.nav.map((n) => n.label);
const linksIntegrations = (shell: ShellView) => labels(shell).includes('Integrations');

describe('the rule: Integrations follows the role the page passes, whatever seat the viewer names', () => {
  const currents: (RailLabel | null)[] = [null, ...ACCOUNT_NAV.map((n) => n.label)];
  for (const role of ROLES) {
    for (const seat of [null, ...ROLES] as const) {
      it(`${role}, viewer naming ${seat ?? 'no'} seat`, () => {
        const v = viewAt(d, viewer(seat));
        for (const current of currents) {
          const shell = accountShellView(v, current, { role });
          expect(linksIntegrations(shell), String(current)).toBe(role !== 'developer');
          expect(labels(shell), String(current)).toContain('Settings');
        }
      });
    }
  }

  it('the agency rail has no Integrations link for any role', () => {
    expect(AGENCY_NAV.map((n) => n.label)).not.toContain('Integrations');
  });
});

/**
 * Every account page's rail, built for a developer. A page told its role is built with a viewer
 * naming the developer's seat and with one naming none. A page that reads the role from its viewer
 * (`readerRole`) is built with the seat, because without one it is a preview, which reads as the
 * owner; its route always names the seat (`lib/v2/account/pages.ts`).
 */
const SITE = d.sites[0]!.id;
// The same account once its trial has ended, back on Free as the state machine leaves it, and a day
// after (as billing-forms.test.ts builds it).
const AFTER_TRIAL = '2026-11-09T12:00:00.000Z';
const ended = {
  ...d,
  accounts: d.accounts.map((a) => ({
    ...a,
    state: 'free' as const,
    state_history: [...a.state_history, { state: 'free' as const, since: '2026-11-08T02:41:00Z' }],
  })),
};
// sitePage draws the rail only for a site on its first check; the route draws the other kind's.
const firstCheck = { ...d, checks: d.checks.filter((c) => c.site_id !== SITE) };
const firstShell = (p: ReturnType<typeof sitePage>) =>
  p.kind === 'first_check' ? p.first.shell : null;
const PAGES: Record<string, (seat: 'developer' | null) => ShellView | null> = {
  'lib/v2/view/settings.ts settingsNotYoursView': (s) =>
    settingsNotYoursView(d, viewer(s), 'developer').shell,
  'lib/v2/view/settings.ts settingsView': (s) =>
    settingsView(d, viewer(s), { role: 'developer' }).shell,
  'lib/v2/view/settings.ts deleteStepView': (s) =>
    deleteStepView(d, viewer(s), { role: 'developer' }).shell,
  'lib/v2/view/trial-end.ts trialEndView': (s) =>
    trialEndView(d, viewer(s), { role: 'developer' }).shell,
  'lib/v2/view/trial-end.ts trialEndedView': (s) =>
    trialEndedView(ended, viewer(s, AFTER_TRIAL), { role: 'developer' })?.shell ?? null,
  'lib/v2/view/reports.ts reportsView': (s) =>
    reportsView(d, viewer(s), {}, '/reports', { role: 'developer' }).shell,
  'lib/v2/view/integrations.ts integrationsView': (s) =>
    integrationsView(d, viewer(s), null, 'developer').shell,
  'lib/v2/view/seats.ts seatsView': () => seatsView(d, viewer('developer')).shell,
  'lib/v2/view/alerts.ts alertsView': () => alertsView(d, viewer('developer')).shell,
  'lib/v2/view/changes-log.ts changesLogView': () =>
    changesLogView(d, viewer('developer'), {}, '/changes').shell,
  'lib/v2/view/dashboard.ts dashboardView': () => dashboardView(d, viewer('developer')).shell,
  'lib/v2/view/dashboard.ts noSiteView': () =>
    dashboardView({ ...d, sites: [], checks: [] }, viewer('developer')).shell,
  'lib/v2/view/site.ts sitePage': () => firstShell(sitePage(firstCheck, viewer('developer'), SITE)),
  // The site page's route draws the rail of a site with a result itself, from the seat its viewer
  // names (lib/v2/account/pages.ts), as sitePage does for a first check.
  'app/sites/[id]/page.tsx SitePage': () => {
    const v = viewAt(d, viewer('developer'));
    return accountShellView(v, 'Sites', { role: readerRole(v) ?? 'developer' });
  },
};

describe('every account page’s rail, for a developer (F-335)', () => {
  for (const [page, build] of Object.entries(PAGES)) {
    for (const seat of ['developer', null] as const) {
      it(`${page}, viewer naming ${seat ?? 'no'} seat`, () => {
        const shell = build(seat);
        expect(shell, 'the page drew no rail').not.toBeNull();
        expect(labels(shell!)).not.toContain('Integrations');
        expect(labels(shell!)).toContain('Settings');
      });
    }
  }
});

/**
 * The call sites the sweep must hold: every `accountShellView(` in a non-test source file under
 * `lib/` and `app/`, named by file and the function around it. Previews draw an owner's rail by
 * design, and the agency builders draw the agency rail, which has no Integrations link (above).
 */
const NOT_SWEPT: Record<string, string> = {
  'app/(v2-preview)/v2-preview/_preview/accounts.ts':
    'previews: a preview names no seat and reads as the owner',
  'lib/v2/view/agency-client.ts': 'the agency rail',
  'lib/v2/view/agency-matrix.ts': 'the agency rail',
  'lib/v2/view/agency-reports.ts': 'the agency rail',
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function callSites(): string[] {
  const web = join(__dirname, '..', '..', '..');
  const found: string[] = [];
  for (const file of [...sources(join(web, 'lib')), ...sources(join(web, 'app'))]) {
    const lines = readFileSync(file, 'utf8').split('\n');
    let fn = '(top level)';
    lines.forEach((line, i) => {
      const def = /^(?:export )?(?:default )?(?:async )?function (\w+)/.exec(line);
      if (def) fn = def[1]!;
      if (/accountShellView\(/.test(line) && !/^export function accountShellView/.test(line)) {
        found.push(`${relative(web, file)}:${i + 1} ${fn}`);
      }
    });
  }
  return found;
}

describe('the sweep holds every page that draws the account rail', () => {
  it('names each call site of accountShellView, or says why it is not swept', () => {
    const sites = callSites();
    expect(sites.length).toBeGreaterThan(10);
    const missing = sites.filter((s) => {
      const [at, fn] = s.split(' ') as [string, string];
      const file = at.slice(0, at.lastIndexOf(':'));
      return !(`${file} ${fn}` in PAGES) && !(file in NOT_SWEPT);
    });
    expect(missing).toEqual([]);
  });
});
