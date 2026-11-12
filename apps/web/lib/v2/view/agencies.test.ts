/**
 * For agencies as data (CC-29 D4). The capability table is held to the repository: a capability
 * marked built is proven by the file that does it, and one marked coming by a proof that it is not
 * there yet, so marking a missing capability built, or leaving one marked coming after it ships,
 * fails here. The page's numbers are held to `prices.ts` and `GATES`, and its one-pager to the
 * public report's builder.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRIAL_DAYS } from '../../billing/state-machine';
import { AGENCY_MONTHLY, PRO_MONTHLY, usd } from '../../billing/prices';
import { GATES } from '../../entitlement-v2';
import { findCheck, fixture } from '../fixtures';
import { CHECKS } from '../recordings';
import { buildPublicSnapshot } from '../reports/build-snapshot';
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

/** Whether a proof is true of the tree as it is. */
function holds(proof: Proof): boolean {
  switch (proof.kind) {
    case 'exists':
      return existsSync(join(REPO, proof.path));
    case 'absent':
      return !existsSync(join(REPO, proof.path));
    case 'holds':
      return readFileSync(join(REPO, proof.path), 'utf8').includes(proof.text);
    case 'nowhere':
      return proof.dirs
        .flatMap((d) => sources(join(REPO, d)))
        .every((f) => !readFileSync(f, 'utf8').includes(proof.text));
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
