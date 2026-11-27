/**
 * The frame's theme is the reader's own seat's, on the Settings pages too: a developer whose seat is
 * dark, on an account whose owner's seat is light, reads Settings dark. A viewer that names no seat
 * reads as the owner, which is how those pages took the owner's theme before their loader named the
 * seat (`lib/v2/account/settings-pages.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import { settingsNotYoursView } from './settings';

const base = fixture('bad-site');
const ACCOUNT = base.accounts[0]!.id;
const OWNER = base.seats[0]!;
const DEV = 'e0000000-0000-4000-8000-0000000000f2';
const d = structuredClone(base);
d.seats[0] = { ...structuredClone(OWNER), theme: 'light' };
d.seats.push({ ...structuredClone(OWNER), id: DEV, role: 'developer', theme: 'dark' });

const themeOf = (seatId: string | undefined) =>
  settingsNotYoursView(
    d,
    seatId === undefined
      ? { accountId: ACCOUNT, now: d.as_of }
      : { accountId: ACCOUNT, seatId, now: d.as_of },
    'developer',
  ).shell.theme;

describe('Settings, the frame’s theme is the reader’s seat’s', () => {
  it('a developer whose seat is dark reads it dark, the owner’s being light', () => {
    expect(themeOf(DEV)).toBe('dark');
  });

  it('a viewer that names no seat reads the owner’s, which is why the loader must name it', () => {
    expect(themeOf(undefined)).toBe('light');
  });
});
