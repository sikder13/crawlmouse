/**
 * For agencies as data (CC-29 D4). The capability table is held to the repository: a capability
 * marked built is proven by the file that does it, and one marked coming by a proof that it is not
 * there yet, so marking a missing capability built, or leaving one marked coming after it ships,
 * fails here. The page's numbers are held to `prices.ts` and `GATES`, and its one-pager to the
 * public report's builder.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TRIAL_DAYS } from '../../billing/state-machine';
import { AGENCY_MONTHLY, PRO_MONTHLY, usd } from '../../billing/prices';
import { GATES } from '../../entitlement-v2';
import { findCheck, fixture } from '../fixtures';
import { CHECKS } from '../recordings';
import { buildPublicSnapshot } from '../reports/build-snapshot';
import { numberWord } from '../words';
import {
  CAPABILITIES,
  agenciesView,
  perSitePhrase,
  type CapabilityKey,
  type Proof,
} from './agencies';

const REPO = join(__dirname, '../../../../..');
/** The table names the text it looks for, so it is the one file the search leaves out. */
const TABLE = join(__dirname, 'agencies.ts');

function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '.next' || name === 'test-support') return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && p !== TABLE ? [p] : [];
  });
}

/** Whether a path is in the tree: on disk, unless `paths` gives the tree as a list of file paths. */
function present(path: string, paths?: ReadonlySet<string>): boolean {
  if (paths === undefined) return existsSync(join(REPO, path));
  if (paths.has(path)) return true;
  for (const p of paths) if (p.startsWith(`${path}/`)) return true;
  return false;
}

/**
 * Whether a proof is true of the tree as it is, or, with `paths`, of a tree whose file paths are
 * those: the path proofs read the list, the text proofs read the files on disk.
 */
function holds(proof: Proof, paths?: ReadonlySet<string>): boolean {
  switch (proof.kind) {
    case 'exists':
      return present(proof.path, paths);
    case 'absent':
      return !present(proof.path, paths);
    case 'all':
      return proof.of.every((p) => holds(p, paths));
    case 'holds':
      return readFileSync(join(REPO, proof.path), 'utf8').includes(proof.text);
    case 'nowhere': {
      const has = (text: string) =>
        typeof proof.text === 'string' ? text.includes(proof.text) : proof.text.test(text);
      return proof.dirs
        .flatMap((d) => sources(join(REPO, d)))
        .every((f) => !has(readFileSync(f, 'utf8')));
    }
  }
}

const ENTRIES = Object.entries(CAPABILITIES) as [
  CapabilityKey,
  (typeof CAPABILITIES)[CapabilityKey],
][];

describe('the capability table', () => {
  it.each(ENTRIES)('%s: its status is proven by the tree as it stands', (_, c) => {
    expect(c.status === 'built' ? c.proof.kind === 'exists' : c.proof.kind !== 'exists').toBe(true);
    expect(holds(c.proof)).toBe(true);
  });

  it.each(ENTRIES.filter(([, c]) => c.status === 'coming'))(
    '%s, coming, carries what names it on the page',
    (_, c) => {
      expect(c.named).toBeInstanceOf(RegExp);
    },
  );

  it('reads the source tree it claims to search', () => {
    expect(sources(join(REPO, 'apps/web/lib')).length).toBeGreaterThan(200);
    expect(sources(join(REPO, 'inngest')).length).toBeGreaterThan(10);
  });

  // The proof readers themselves, on each side.
  it('tells a present path from an absent one, and text present from text absent', () => {
    const one: Proof = { kind: 'absent', path: 'apps/web/app/agency' };
    const other: Proof = { kind: 'absent', path: 'apps/web/app/api/checks/route.ts' };
    expect(holds({ kind: 'all', of: [one, one] })).toBe(true);
    expect(holds({ kind: 'all', of: [one, other] })).toBe(false);
    expect(holds({ kind: 'all', of: [other, one] })).toBe(false);
    const listed = new Set(['apps/web/app/agency/page.tsx']);
    expect(holds(one, listed)).toBe(false);
    expect(holds({ kind: 'absent', path: 'apps/web/app/agenc' }, listed)).toBe(true);
    expect(holds({ kind: 'exists', path: 'apps/web/app/api/checks/route.ts' })).toBe(true);
    expect(holds({ kind: 'exists', path: 'apps/web/app/agency' })).toBe(false);
    expect(holds({ kind: 'absent', path: 'apps/web/app/api/checks/route.ts' })).toBe(false);
    expect(holds({ kind: 'holds', path: 'apps/web/lib/billing/prices.ts', text: 'usd(' })).toBe(
      true,
    );
    expect(holds({ kind: 'nowhere', dirs: ['apps/web/lib'], text: 'export function usd' })).toBe(
      false,
    );
  });
});

// Tier B TB-N1: each coming capability's pattern, varied over the ways the pages and FACTS name it.
// Pricing's plan rows and FACTS's tier line are in this list, not only the copy written to pass it.
const PARAPHRASES: Partial<Record<CapabilityKey, readonly string[]>> = {
  weekly_checks: [
    'weekly checks on up to 5 sites',
    'Re-checked weekly',
    'Re-checked monthly',
    'checked weekly',
    're-checks every client site',
    'recheck',
    'scheduled checks',
    'every week',
    'checking again',
    'checked again',
    'Keeps monthly checks',
    'Pay when you want it watched',
    'developers watching up to 5 sites',
  ],
  change_emails: [
    'an email only if something changed',
    'alerts by email and Slack',
    'a note when a check finds a change',
    'a note when a re-check finds a change',
    'telling you what changed',
    'you hear first',
    'Crawlmouse fetches your site as each AI crawler and tells you when that changes.',
  ],
  slack_alerts: ['alerts by email and Slack', 'Slack alerts'],
  exports: ['PDF, CSV and JSON', 'PDF/CSV/JSON export', 'export', 'Exports'],
  staging: [
    'Audit preview and staging URLs before you deploy',
    'staging/preview audits',
    'a staging URL',
  ],
  renders: ['10 full renders a month', '30 renders', 'Full JavaScript renders a month'],
  seats: ['5 seats', 'Two seats', '$12 a seat beyond', 'one seat'],
  competitors: ['1 competitor per site', '3 competitors', 'Competitors per site'],
  trial_reminder: [
    'We email you three days before',
    'one reminder three days before the 14 days end',
    'We email you 3 days before',
  ],
  renewal_reminders: [
    'We email you 45 and 20 days before an annual renewal',
    'renewal reminders at 45 and 20 days',
  ],
  agency_plus_reply: ['We reply from support@crawlmouse.com', 'Talk to us'],
  client_report_page: ['reports on your domain with your logo', 'client report page'],
  sender_address: ['emails from your address', 'Emails to clients from your address'],
  client_matrix: ['Client matrix', 'every client on one screen'],
  observed_crawlers: [
    'Pro also lists the crawlers it has seen on your site (observed activity).',
    'observed activity',
  ],
  one_pagers: ['client one-pagers', 'Prospect one-pagers', 'one-page summary'],
  client_reports: [
    'reports under your name',
    'Agencies reporting to clients under their own name.',
    'Weekly or monthly client reports, sent for you',
    'client reports',
    'shown on client reports',
  ],
  evidence_condensed: [
    'Evidence older than 90 days is condensed to headers and the parts of pages that changed.',
    'evidence older than 30 days',
  ],
  agency_workspace: [
    'its first audit runs from the agency workspace',
    'set your domain and logo under Branding',
  ],
};

/** Text naming only built things, which no coming pattern may match. */
const BUILT_ONLY = [
  'Server-render the product template, 158 pages',
  'Monthly',
  'Yearly',
  'Up to 2,000 pages per audit',
  'Every fix the audit finds, with packets for your coding tool',
  'Any day, with no call. The account goes back to Free.',
  'Sent. Your request is recorded.',
];

describe('what names a coming capability', () => {
  it.each(Object.entries(PARAPHRASES))('%s: each paraphrase is named', (key, phrases) => {
    const cap = CAPABILITIES[key as CapabilityKey];
    expect(cap.status).toBe('coming');
    expect(phrases!.filter((p) => !cap.named!.test(p))).toEqual([]);
  });

  it('every coming capability has paraphrases here', () => {
    const coming = ENTRIES.filter(([, c]) => c.status === 'coming').map(([k]) => k);
    expect(coming.filter((k) => !(k in PARAPHRASES))).toEqual([]);
  });

  it.each(BUILT_ONLY)('"%s" names no coming capability', (text) => {
    const named = ENTRIES.filter(([, c]) => c.named?.test(text)).map(([k]) => k);
    expect(named).toEqual([]);
  });
});

describe('the For agencies view', () => {
  const view = agenciesView();

  it('prices the trial and the plans from prices.ts, the trial length from the state machine', () => {
    expect(view.trialNote.text).toContain(`then ${usd(AGENCY_MONTHLY)} a month`);
    expect(view.trialNote.text).toContain(`nothing charged for ${TRIAL_DAYS} days`);
    expect(view.trial.text).toBe(`Start a ${TRIAL_DAYS}-day trial`);
    expect(view.compare.columns).toEqual([
      'What you get',
      `Pro · ${usd(PRO_MONTHLY)}`,
      `Agency · ${usd(AGENCY_MONTHLY)}`,
    ]);
  });

  it('takes every limit in the comparison from GATES', () => {
    const cells = Object.fromEntries(view.compare.rows.map((r) => [r.key, [r.pro, r.agency]]));
    expect(cells.sites).toEqual([String(GATES.pro.sites), String(GATES.agency.sites)]);
    expect(cells.seats).toEqual([String(GATES.pro.seats), String(GATES.agency.seats)]);
    expect(cells.competitors).toEqual([
      String(GATES.pro.competitorsPerSite),
      String(GATES.agency.competitorsPerSite),
    ]);
  });

  it('prints no figure the catalogue, GATES or the fixture does not hold', () => {
    const allowed = new Set([
      AGENCY_MONTHLY,
      PRO_MONTHLY,
      TRIAL_DAYS,
      Math.ceil(AGENCY_MONTHLY / GATES.agency.sites),
      ...Object.values(GATES).flatMap((g) => [g.sites, g.seats, g.competitorsPerSite]),
    ]);
    const { onePager, ...page } = view;
    const figures = JSON.stringify(page).match(/\d+/g)!.map(Number);
    expect(figures.filter((n) => !allowed.has(n))).toEqual([]);
    expect(onePager.fixes.length).toBe(3);
  });

  it('marks as coming each piece that names a capability not built, and no other', () => {
    const pieces = [
      ...view.hero,
      view.trial,
      view.trialNote,
      view.prospect.title,
      ...view.prospect.lines,
      ...view.compare.rows.map((r) => r.label),
      ...view.uses.steps,
      ...view.cost.lines,
    ];
    for (const p of pieces) {
      expect(p.coming, p.text).toBe(
        p.capabilities.some((k) => CAPABILITIES[k].status === 'coming'),
      );
    }
    expect(view.trial.coming).toBe(false);
    expect(view.onePager.coming).toBe(true);
  });

  it('shows the one-pager of the public report the fixture would mint, labelled as a sample', () => {
    const d = fixture('bad-site');
    const check = findCheck(d, CHECKS.badFirstAudit);
    const s = buildPublicSnapshot(d, check.id, check.finished_at!);
    expect(view.onePager.heading).toBe(`${s.host}: ${s.headline}`);
    expect(view.onePager.grades.map((g) => [g.label, g.letter, g.score])).toEqual(
      s.grades.map((g) => [g.label, g.letter, g.score]),
    );
    expect(view.onePager.fixes.map((f) => f.points)).toEqual(s.topFixes.map((f) => f.points));
    expect(view.onePager.label).toContain('a sample agency');
    expect(view.onePager.grades.map((g) => g.label)).toContain('AI readability');
  });
});

describe('perSitePhrase', () => {
  it('says the price exactly when it divides evenly, and "under" the next dollar when it does not', () => {
    expect(perSitePhrase(75, 25)).toBe('$3');
    expect(perSitePhrase(99, 25)).toBe('under $4');
    expect(perSitePhrase(69, 25)).toBe('under $3');
    expect(perSitePhrase(76, 25)).toBe('under $4');
  });

  it('is true of the computed share for every whole price up to $500 and 1 to 60 sites', () => {
    for (let price = 1; price <= 500; price++) {
      for (let sites = 1; sites <= 60; sites++) {
        const phrase = perSitePhrase(price, sites);
        const n = Number(phrase.replace(/\D/g, ''));
        if (phrase.startsWith('under')) expect(price / sites).toBeLessThan(n);
        else expect(price / sites).toBe(n);
      }
    }
  });
});

// Tier B TB-N3: a figure typed into the copy that equals today's value, as a numeral or a word,
// passes a membership check. The view is built again against GATES and prices no copy could
// contain, and today's values must be gone from it.
describe('the figures follow GATES and prices.ts, not the values typed today', () => {
  const ALTERED = {
    pro: { sites: 11, seats: 3, competitorsPerSite: 2 },
    agency: { sites: 37, seats: 13, competitorsPerSite: 6 },
    PRO_MONTHLY: 23,
    AGENCY_MONTHLY: 123,
  };

  async function alteredView() {
    vi.resetModules();
    vi.doMock('../../entitlement-v2', async (importOriginal) => {
      const real = await importOriginal<typeof import('../../entitlement-v2')>();
      return {
        ...real,
        GATES: {
          ...real.GATES,
          pro: { ...real.GATES.pro, ...ALTERED.pro },
          agency: { ...real.GATES.agency, ...ALTERED.agency },
        },
      };
    });
    vi.doMock('../../billing/prices', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../billing/prices')>()),
      PRO_MONTHLY: ALTERED.PRO_MONTHLY,
      AGENCY_MONTHLY: ALTERED.AGENCY_MONTHLY,
    }));
    try {
      return (await import('./agencies')).agenciesView();
    } finally {
      vi.doUnmock('../../entitlement-v2');
      vi.doUnmock('../../billing/prices');
      vi.resetModules();
    }
  }

  /**
   * Today's figures the alteration moves, each with its word. One and two are left out: "one click"
   * and "two clicks" are the page's words for other things.
   */
  const moved = [
    GATES.pro.sites,
    GATES.pro.seats,
    GATES.pro.competitorsPerSite,
    GATES.agency.sites,
    GATES.agency.seats,
    GATES.agency.competitorsPerSite,
    PRO_MONTHLY,
    AGENCY_MONTHLY,
  ].filter(
    (n) =>
      ![
        ...Object.values(ALTERED.pro),
        ...Object.values(ALTERED.agency),
        ALTERED.PRO_MONTHLY,
        ALTERED.AGENCY_MONTHLY,
        TRIAL_DAYS,
      ].includes(n) && n > 2,
  );

  it('the altered values reach the page', async () => {
    const text = JSON.stringify({ ...(await alteredView()), onePager: null });
    for (const n of [ALTERED.agency.sites, ALTERED.agency.seats, ALTERED.AGENCY_MONTHLY])
      expect(text, String(n)).toContain(String(n));
    expect(text).toContain(numberWord(ALTERED.agency.seats));
  });

  it('none of today’s moved values is left, as a numeral or as a word', async () => {
    const text = JSON.stringify({ ...(await alteredView()), onePager: null });
    expect(moved.length).toBeGreaterThan(4);
    const left = moved.filter(
      (n) =>
        new RegExp(`(?<![\\d,.])${n}(?![\\d,])`).test(text) ||
        (numberWord(n) !== String(n) && new RegExp(`\\b${numberWord(n)}\\b`, 'i').test(text)),
    );
    expect(left).toEqual([]);
  });
});

// SEO R2-N3, the merge trap: each coming row's proof names the file its own step adds, so merging
// CC-28 flips the rows CC-28 builds and no others. The proofs are run against the tree after that
// merge as far as paths go: this tree's files plus those CC-28's branch adds, less those it deletes,
// frozen in __tests__/__fixtures__/cc-28-paths.txt with the command that read them. Text proofs read
// this tree; on CC-28's tree the ones that change answer are weekly_checks' and slack_alerts' text,
// each beside a path proof that already flips its row, measured with
//   git grep -lE '<the proof's pattern>' origin/build/cc-28-monitoring -- apps/web/lib apps/web/app inngest packages/worker/src
describe('the capability table after CC-28 is merged', () => {
  const fixture = readFileSync(
    join(__dirname, '../../../__tests__/__fixtures__/cc-28-paths.txt'),
    'utf8',
  )
    .split('\n')
    .filter((l) => l !== '' && !l.startsWith('#'))
    .map((l) => l.split('\t') as [string, string]);
  const tracked = (dir: string): string[] =>
    sources(join(REPO, dir)).map((f) => f.slice(REPO.length + 1));

  /** This tree's paths, as far as the proofs look, with CC-28's additions and deletions applied. */
  function merged(): Set<string> {
    const paths = new Set<string>();
    for (const c of Object.values(CAPABILITIES)) {
      const walk = (p: Proof): void => {
        if (p.kind === 'all') return p.of.forEach(walk);
        if (p.kind === 'exists' || p.kind === 'absent') {
          if (existsSync(join(REPO, p.path))) {
            if (statSync(join(REPO, p.path)).isDirectory())
              tracked(p.path).forEach((f) => paths.add(f));
            else paths.add(p.path);
          }
        }
      };
      walk(c.proof);
    }
    for (const [status, path] of fixture) {
      if (status === 'A') paths.add(path);
      else paths.delete(path);
    }
    return paths;
  }

  it('reads the frozen list: CC-28’s mail templates and monitor files among its additions', () => {
    expect(fixture.length).toBeGreaterThan(100);
    expect(fixture.every(([status]) => status === 'A' || status === 'D')).toBe(true);
    const added = fixture.map(([, p]) => p);
    expect(added).toContain('apps/web/lib/v2/mail/templates/trial-reminder.ts');
    expect(added).toContain('apps/web/lib/v2/monitor/schedule.ts');
  });

  it('flips exactly the trial reminder, the change email, scheduled checks and Slack', () => {
    const tree = merged();
    const flipped = ENTRIES.filter(([, c]) => c.status === 'coming' && !holds(c.proof, tree))
      .map(([k]) => k)
      .sort();
    expect(flipped).toEqual(['change_emails', 'slack_alerts', 'trial_reminder', 'weekly_checks']);
  });

  it('keeps every built row built, and the renewal reminders and the Agency Plus reply coming', () => {
    const tree = merged();
    for (const [key, c] of ENTRIES.filter(([, c]) => c.status === 'built'))
      expect(holds(c.proof, tree), key).toBe(true);
    expect(holds(CAPABILITIES.renewal_reminders.proof, tree)).toBe(true);
    expect(holds(CAPABILITIES.agency_plus_reply.proof, tree)).toBe(true);
  });

  // The two rows CC-28 does not build name template files of their own, not the folder CC-28 adds.
  it('names, for each email CC-28 does not build, a template file of its own', () => {
    for (const key of ['renewal_reminders', 'agency_plus_reply'] as const) {
      const proof = CAPABILITIES[key].proof;
      expect(proof.kind, key).toBe('absent');
      if (proof.kind === 'absent')
        expect(proof.path, key).toMatch(/^apps\/web\/lib\/v2\/mail\/templates\/[a-z-]+\.ts$/);
    }
  });
});
