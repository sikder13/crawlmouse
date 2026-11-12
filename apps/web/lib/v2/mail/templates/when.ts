/**
 * How a time reads in mail prose (CC-28, owner rulings-3 item 4): the account's clock, with the zone's
 * short name when Intl has one ("21:41 EST", "03:41 CET") and "your time" when Intl gives only an
 * offset ("GMT+9"). The IANA name is never shown. when.test.ts holds both outcomes.
 */
import { hourMinute } from '../../format';

/** en-US names the US zones; en-GB names the European ones en-US gives as an offset. */
const LOCALES = ['en-US', 'en-GB'] as const;
/** An offset, not a name: "GMT+9", "GMT-5", "UTC+05:30". Bare "GMT" and "UTC" are names. */
const OFFSET = /^(?:GMT|UTC)[+\-−]/;

/** The zone's short name at `ts`, or null when no locale gives one but an offset. */
export function zoneShortName(ts: string, zone: string): string | null {
  for (const locale of LOCALES) {
    const name = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(new Date(ts))
      .find((p) => p.type === 'timeZoneName')?.value;
    if (name !== undefined && !OFFSET.test(name)) return name;
  }
  return null;
}

/** "21:41 EST", or "21:41 your time". */
export function clockTime(ts: string, zone: string): string {
  return `${hourMinute(ts, zone)} ${zoneShortName(ts, zone) ?? 'your time'}`;
}
