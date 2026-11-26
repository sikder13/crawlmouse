/**
 * D-17 (QA's production dashboard walk, 24 Nov): Settings had no time zone control, so an account
 * stayed on the zone it was created with. The Account card now offers one. It posts `timezone` with
 * the card's other fields, to the `PATCH /api/account` form body that already accepts it.
 *
 * The options are the names that body accepts (`ZONES`), so the select cannot post one it refuses.
 * An account may hold a name outside that list: sign-up stores any zone the browser names, and on
 * Node 22 ICU lists `America/Indianapolis` but not `America/Indiana/Indianapolis`. The field shows
 * such a zone as its canonical name, the same zone, because a select whose value is missing from
 * its options posts its first option, and Save would then move the account to that zone.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_VIEWERS,
  CLEAN_VIEWER,
} from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { parseProfile, ZONES } from '../account/profile';
import { fixture } from '../fixtures';
import { settingsView } from './settings';
import { listedZone } from './zone-field';

type Dataset = ReturnType<typeof fixture>;

/** bad-site with its account's zone replaced, everything else as the fixture has it. */
function withZone(zone: string): Dataset {
  const d = fixture('bad-site');
  return { ...d, accounts: d.accounts.map((a) => ({ ...a, timezone: zone })) } as Dataset;
}

const zoneOf = (d: Dataset) => settingsView(d, ACCOUNT_VIEWERS.home()).account.zone;

describe('Settings, the account’s time zone (D-17)', () => {
  it('offers the zone as a field the account form posts, labelled and explained', () => {
    const z = zoneOf(withZone('Europe/London'))!;
    expect(z).toMatchObject({
      id: 'account-zone',
      label: 'Time zone',
      name: 'timezone',
      value: 'Europe/London',
    });
    expect(z.hint).toBe(
      'Dates and times on these pages are in this zone. Changing it moves each site’s next check to the same local time in the new zone.',
    );
  });

  it('lists exactly the names the save accepts, UTC first and the rest in order', () => {
    const z = zoneOf(withZone('Europe/London'))!;
    const values = z.options.map((o) => o.value);
    expect(new Set(values)).toEqual(ZONES);
    expect(values.length).toBe(ZONES.size);
    expect(values[0]).toBe('UTC');
    const rest = values.slice(1);
    expect(rest).toEqual([...rest].sort());
  });

  it('labels each name as words, without underscores', () => {
    const z = zoneOf(withZone('Europe/London'))!;
    const ny = z.options.find((o) => o.value === 'America/New_York');
    expect(ny?.label).toBe('America/New York');
    expect(z.options.every((o) => !o.label.includes('_'))).toBe(true);
  });

  it('every option posts and is saved, in the form body the Account card sends', () => {
    const z = zoneOf(withZone('UTC'))!;
    const refused = z.options.filter(
      (o) =>
        !parseProfile(
          { kind: 'form', fields: { name: '', newEmail: 'you@company.com', timezone: o.value } },
          'you@company.com',
        ).ok,
    );
    expect(refused).toEqual([]);
  });

  it('shows a zone outside the list as its canonical name, so Save does not move the account', () => {
    // The fixture's own zone, which a browser reports and sign-up stores.
    expect(ZONES.has('America/Indiana/Indianapolis')).toBe(false);
    expect(zoneOf(fixture('bad-site'))!.value).toBe('America/Indianapolis');
    for (const [stored, shown] of [
      ['Asia/Kolkata', 'Asia/Calcutta'],
      ['Europe/Kyiv', 'Europe/Kiev'],
      ['Etc/UTC', 'UTC'],
      ['US/Eastern', 'America/New_York'],
    ] as const) {
      expect(ZONES.has(stored), stored).toBe(false);
      const z = zoneOf(withZone(stored))!;
      expect(z.value, stored).toBe(shown);
      expect(z.options.some((o) => o.value === z.value)).toBe(true);
    }
  });

  it('lists no name for a zone this runtime does not know', () => {
    // The view never meets one: the page's dates are formatted in the account's zone, and throw
    // first. listedZone's null is the field's guard all the same.
    expect(listedZone('Mars/Olympus_Mons')).toBeNull();
    expect(listedZone('Europe/London')).toBe('Europe/London');
  });

  it('is there for the stand-in Free account too', () => {
    const z = settingsView(fixture('clean-site'), CLEAN_VIEWER).account.zone;
    expect(z?.name).toBe('timezone');
  });
});
