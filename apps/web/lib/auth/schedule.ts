/**
 * The re-check schedule a site gets when an account takes it on (a named first site, or a claimed
 * audit). The cadence is the tier's (`GATES[tier].schedule`); the weekday is the day it was attached,
 * in the account's time zone, and the hour is 06:00 local, the default `apply_entitlement_transition`
 * gives a resumed site (migration 003).
 */
import { GATES, type Tier } from '../entitlement-v2';

export const SCHEDULE_HOUR_LOCAL = 6;

export interface SiteSchedule {
  cadence: 'weekly' | 'monthly';
  iso_weekday: number;
  hour_local: number;
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** `zone` when the runtime knows it, else UTC (the database's fallback for an unknown zone). */
export function knownZone(zone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return 'UTC';
  }
}

export function isoWeekdayIn(at: Date, zone: string): number {
  const short = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: knownZone(zone),
  }).format(at);
  const day = WEEKDAY[short];
  if (day === undefined) throw new Error(`unexpected weekday ${short}`);
  return day;
}

export function scheduleFor(
  tier: Tier,
  isFirstSite: boolean,
  at: Date,
  zone: string,
): SiteSchedule | null {
  const rule = GATES[tier].schedule;
  const cadence = rule === 'weekly' ? 'weekly' : isFirstSite ? 'monthly' : null;
  if (cadence === null) return null;
  return { cadence, iso_weekday: isoWeekdayIn(at, zone), hour_local: SCHEDULE_HOUR_LOCAL };
}
