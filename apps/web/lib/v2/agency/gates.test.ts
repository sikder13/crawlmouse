import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENCY_MONTHLY, EXTRA_SITE, PRO_MONTHLY } from '../../billing/prices';
import { GATES } from '../../entitlement-v2';
import { agencyGateMessage, gateMessage, nextTier, sitesFullMessage } from './gates';

/** `gates.ts` without its block comments and its import lines (a module path may hold a digit). */
function codeOf(source: string): string {
  let out = '';
  let inBlock = false;
  for (const line of source.split('\n')) {
    if (!inBlock && line.startsWith('import ')) continue;
    let rest = line;
    if (inBlock) {
      const end = rest.indexOf('*/');
      if (end === -1) continue;
      rest = rest.slice(end + 2);
      inBlock = false;
    }
    const open = rest.indexOf('/*');
    if (open !== -1 && rest.indexOf('*/', open) === -1) {
      inBlock = true;
      rest = rest.slice(0, open);
    }
    out += `${rest}\n`;
  }
  return out;
}

describe('gateMessage', () => {
  it('names the limit reached and the plan that lifts it, with its price', () => {
    expect({
      'free sites': gateMessage('sites', 'free'),
      'free seats': gateMessage('seats', 'free'),
      'free fixes': gateMessage('fixes', 'free'),
      'free exports': gateMessage('exports', 'free'),
      'pro sites': gateMessage('sites', 'pro'),
      'pro seats': gateMessage('seats', 'pro'),
      'pro client reports': gateMessage('clientReports', 'pro'),
    }).toEqual({
      'free sites': `Free keeps ${GATES.free.sites} site. Pro keeps ${GATES.pro.sites} sites: Pro is $${PRO_MONTHLY} a month.`,
      'free seats': `Free has ${GATES.free.seats} seat. Pro has ${GATES.pro.seats} seats: Pro is $${PRO_MONTHLY} a month.`,
      'free fixes': `Free opens the ${GATES.free.fixesVisible} largest fixes of a check. Pro opens every fix: Pro is $${PRO_MONTHLY} a month.`,
      'free exports': `Reports and exports are made on Pro. Pro is $${PRO_MONTHLY} a month.`,
      'pro sites': `Pro keeps ${GATES.pro.sites} sites. Agency keeps ${GATES.agency.sites} sites: Agency is $${AGENCY_MONTHLY} a month.`,
      'pro seats': `Pro has ${GATES.pro.seats} seats. Agency has ${GATES.agency.seats} seats: Agency is $${AGENCY_MONTHLY} a month.`,
      'pro client reports': `Reports sent to a client are made on Agency. Agency is $${AGENCY_MONTHLY} a month.`,
    });
  });

  it('says nothing for a gate the next plan does not lift', () => {
    expect(gateMessage('fixes', 'pro')).toBeNull();
    expect(gateMessage('exports', 'pro')).toBeNull();
    expect(gateMessage('clientReports', 'free')).toBeNull();
  });

  it('reads today’s figures: the seats of Free and Pro, the sites of Pro and Agency, both prices', () => {
    // Written out once, so a change to GATES or prices.ts shows here as a changed sentence.
    expect(gateMessage('seats', 'free')).toBe(
      'Free has 1 seat. Pro has 2 seats: Pro is $19 a month.',
    );
    expect(gateMessage('sites', 'pro')).toBe(
      'Pro keeps 5 sites. Agency keeps 25 sites: Agency is $99 a month.',
    );
  });

  it('has no digit in its code', () => {
    const code = codeOf(readFileSync(resolve(__dirname, 'gates.ts'), 'utf8'));
    expect(code).toContain('export function gateMessage');
    expect(code.match(/\d/g)).toBeNull();
  });
});

describe('agencyGateMessage', () => {
  it('names what Agency keeps and its price, from GATES and prices.ts', () => {
    expect(agencyGateMessage()).toBe(
      `Clients, their matrix and their pages are on Agency, which keeps ${GATES.agency.sites} sites and ${GATES.agency.seats} seats: Agency is $${AGENCY_MONTHLY} a month.`,
    );
    // Written out once, so a change to GATES or prices.ts shows here as a changed sentence.
    expect(agencyGateMessage()).toBe(
      'Clients, their matrix and their pages are on Agency, which keeps 25 sites and 5 seats: Agency is $99 a month.',
    );
  });
});

describe('sitesFullMessage', () => {
  it('below Agency is the sites gate: the plan’s sites, the next plan’s, and its price', () => {
    expect(sitesFullMessage('free')).toBe(gateMessage('sites', 'free'));
    expect(sitesFullMessage('pro')).toBe(gateMessage('sites', 'pro'));
  });

  it('on Agency says what a site beyond the plan’s costs, from GATES and prices.ts', () => {
    expect(sitesFullMessage('agency')).toBe(
      `Agency keeps ${GATES.agency.sites} sites. A site beyond them is $${EXTRA_SITE} a month.`,
    );
    // Written out once, so a change to GATES or prices.ts shows here as a changed sentence.
    expect(sitesFullMessage('agency')).toBe(
      'Agency keeps 25 sites. A site beyond them is $3 a month.',
    );
  });
});

describe('the gate sentences other files say', () => {
  // Each file below words a limit or a price for a reader. None may write the number itself: the
  // sentence comes from gates.ts, or takes the number as a parameter.
  const HAND_WRITTEN = /\$\s?\d|\b\d+\s+(?:sites?|seats?|clients?|fix(?:es)?)\b/;
  const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8');
  /** The code without its comments, which quote examples ("Agency · $99 a month"). */
  const uncommented = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('finds a hand-written price or limit where there is one', () => {
    expect('Agency is $99 a month').toMatch(HAND_WRITTEN);
    expect('keeps 25 sites').toMatch(HAND_WRITTEN);
    expect('has 5 seats').toMatch(HAND_WRITTEN);
    expect('`${count(n)} sites`').not.toMatch(HAND_WRITTEN);
  });

  it.each([
    ['../copy/agency.ts', 'MATRIX_COPY', '// ── Where the agency screens differ'],
    ['../copy/notices.ts', 'export const NOTICE_LINES', 'export const NOTICE_ADDITIONS'],
    [
      '../copy/settings-notices.ts',
      'export const OWN_ACCOUNT_COPY',
      'export const REFUSAL_SENTENCES',
    ],
  ])('%s, from %s: no price and no limit written as a digit', (path, from, to) => {
    const source = read(path);
    const [start, end] = [source.indexOf(from), source.indexOf(to)];
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const copy = uncommented(source.slice(start, end));
    expect(copy.length).toBeGreaterThan(100);
    expect(copy.match(HAND_WRITTEN)).toBeNull();
  });

  it('the rail’s plan card takes its price as a parameter', () => {
    const source = read('../copy/agency.ts');
    const rail = uncommented(source.slice(0, source.indexOf('export const MATRIX_COPY')));
    expect(rail).toContain('planPrice');
    expect(rail.match(HAND_WRITTEN)).toBeNull();
  });
});

describe('nextTier', () => {
  it('is Pro for Free, Agency for Pro, and none for Agency', () => {
    expect([nextTier('free'), nextTier('pro'), nextTier('agency')]).toEqual([
      'pro',
      'agency',
      null,
    ]);
  });
});
