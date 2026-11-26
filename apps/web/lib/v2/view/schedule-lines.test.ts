/**
 * F-115: the schedule and the next check say one time. A site's checks run at its hour plus a fixed
 * minute (`schedule_offset_min`), and "monthly" is the first such weekday of the month
 * (`next_check_after`, migration 20261113000001). bad-site's example-outfitter.com is weekly, Fri at
 * 06, in America/Indiana/Indianapolis (EST in November): 11:37Z on 6 Nov is 06:37 there.
 */
import type { FixtureDataset, Site } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_VIEWERS } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import { scheduleCell } from './checks';
import { dashboardView } from './dashboard';
import { siteView } from './site';

const SITE = '50000000-0000-4000-8000-000000000001';
const bad = fixture('bad-site');
const viewer = ACCOUNT_VIEWERS.home();
const site = bad.sites.find((s) => s.id === SITE)!;
const next = new Map([[SITE, '2026-11-06T11:37:00.000Z']]);

const scheduleRow = (d: FixtureDataset, n?: ReadonlyMap<string, string | null>) =>
  siteView(d, viewer, SITE, n).settings.rows.find((r) => r.label === 'Schedule')!;

describe('the schedule cell', () => {
  it('says which weekday of the month a monthly check runs on', () => {
    const monthly: Site = { ...site, schedule: { ...site.schedule!, cadence: 'monthly' } };
    expect(scheduleCell(monthly)).toBe('monthly, first Fri');
  });

  it('leaves a weekly check as it was', () => {
    expect(scheduleCell(site)).toBe('weekly, Fri');
  });
});

describe('the site page', () => {
  it('gives the schedule the same time as the next check', () => {
    expect(scheduleRow(bad, next).value).toBe(
      'weekly, Fri around 06:37, America/Indiana/Indianapolis',
    );
    expect(siteView(bad, viewer, SITE, next).header.line).toContain('next Fri 6 Nov around 06:37');
  });

  it('keeps the chosen hour where the scheduler has no time for the site', () => {
    expect(scheduleRow(bad).value).toBe('weekly, Fri around 06:00, America/Indiana/Indianapolis');
    expect(scheduleRow(bad, new Map([[SITE, null]])).value).toBe(
      'weekly, Fri around 06:00, America/Indiana/Indianapolis',
    );
  });

  it('the dashboard’s set-up line says the same time', () => {
    const line = dashboardView(bad, viewer, next).setup!.schedule!.label;
    expect(line).toBe(
      'Choose the day and hour example-outfitter.com is checked weekly (now Fri around 06:37 EST)',
    );
  });

  it('the dashboard’s set-up line keeps the chosen hour with no scheduler time', () => {
    expect(dashboardView(bad, viewer).setup!.schedule!.label).toBe(
      'Choose the day and hour example-outfitter.com is checked weekly (now Fri around 06:00 EST)',
    );
  });

  it('names the zone on the hour field', () => {
    const hour = scheduleRow(bad).action!.inputs!.find((i) => i.name === 'hour')!;
    expect(hour.label).toBe('Hour, America/Indiana/Indianapolis');
  });
});
