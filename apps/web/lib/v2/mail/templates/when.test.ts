import { describe, expect, it } from 'vitest';
import { clockTime, zoneShortName } from './when';

// Rulings-3 item 4: a time in prose names the zone by the short name Intl gives, never the IANA name;
// when Intl gives only an offset ("GMT+9"), it says "your time".
describe('a time in prose', () => {
  it.each([
    // en-US names the US zones, and their daylight names in summer.
    ['America/Indiana/Indianapolis', '2026-11-08T02:41:00.000Z', '21:41 EST'],
    ['America/Indiana/Indianapolis', '2026-07-08T02:41:00.000Z', '22:41 EDT'],
    ['Pacific/Honolulu', '2026-11-08T02:41:00.000Z', '16:41 HST'],
    // en-US gives an offset for Berlin and London's summer; en-GB names them.
    ['Europe/Berlin', '2026-11-08T02:41:00.000Z', '03:41 CET'],
    ['Europe/London', '2026-07-08T02:41:00.000Z', '03:41 BST'],
    ['Europe/London', '2026-11-08T02:41:00.000Z', '02:41 GMT'],
    ['UTC', '2026-11-08T02:41:00.000Z', '02:41 UTC'],
    // Neither locale names these: an offset alone, so "your time".
    ['Asia/Tokyo', '2026-11-08T02:41:00.000Z', '11:41 your time'],
    ['Asia/Kolkata', '2026-11-08T02:41:00.000Z', '08:11 your time'],
    ['Etc/GMT+5', '2026-11-08T02:41:00.000Z', '21:41 your time'],
  ])('%s at %s reads %s', (zone, ts, want) => {
    expect(clockTime(ts, zone)).toBe(want);
    expect(clockTime(ts, zone)).not.toContain('/');
  });

  it('answers null for an offset-only zone, and never an IANA name', () => {
    expect(zoneShortName('2026-11-08T02:41:00.000Z', 'Asia/Tokyo')).toBeNull();
    expect(zoneShortName('2026-11-08T02:41:00.000Z', 'America/New_York')).toBe('EST');
  });
});
