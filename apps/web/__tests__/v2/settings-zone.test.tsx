/**
 * D-17: the Account card's time zone select, as rendered. It sits in the card's one form, so Save
 * posts it with the name and the address; it is selected at the account's zone; its hint is tied to
 * it; and it is marked as an addition to the locked Final-Settings, with its entry in the register.
 */
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_VIEWERS } from '../../app/(v2-preview)/v2-preview/_preview/accounts';
import { SettingsScreen } from '../../components/v2/screens/settings/SettingsScreen';
import { SETTINGS_ADDITIONS } from '../../lib/v2/copy/settings';
import { fixture } from '../../lib/v2/fixtures';
import { settingsView } from '../../lib/v2/view/settings';

type Dataset = ReturnType<typeof fixture>;

function render(zone: string | null) {
  const d = fixture('bad-site');
  const data: Dataset =
    zone === null
      ? d
      : ({ ...d, accounts: d.accounts.map((a) => ({ ...a, timezone: zone })) } as Dataset);
  const html = renderToStaticMarkup(
    <SettingsScreen data={settingsView(data, ACCOUNT_VIEWERS.home())} />,
  );
  return new JSDOM(html).window.document;
}

describe('Settings, the time zone select (D-17)', () => {
  it('is in the Account card’s form, named timezone, at the account’s zone', () => {
    const doc = render('Europe/London');
    const select = doc.querySelector<HTMLSelectElement>('select#account-zone')!;
    expect(select).not.toBeNull();
    expect(select.name).toBe('timezone');
    const form = select.closest('form')!;
    expect(form.querySelector('input[name="name"]')).not.toBeNull();
    expect(form.querySelector('input[name="newEmail"]')).not.toBeNull();
    const chosen = [...select.querySelectorAll('option')].filter((o) => o.hasAttribute('selected'));
    expect(chosen.map((o) => o.value)).toEqual(['Europe/London']);
  });

  it('has a label and a hint tied to it', () => {
    const doc = render('Europe/London');
    expect(doc.querySelector('label[for="account-zone"]')?.textContent).toBe('Time zone');
    const hint = doc.getElementById(
      doc.querySelector('#account-zone')!.getAttribute('aria-describedby')!,
    );
    expect(hint?.textContent).toMatch(/^Dates and times on these pages are in this zone\./);
  });

  it('selects the canonical name of a zone stored under another one', () => {
    const doc = render(null); // the fixture's America/Indiana/Indianapolis
    const chosen = [...doc.querySelectorAll('#account-zone option')].filter((o) =>
      o.hasAttribute('selected'),
    );
    expect(chosen.map((o) => o.getAttribute('value'))).toEqual(['America/Indianapolis']);
  });

  it('is marked as an addition to Final-Settings, and registered with its source', () => {
    const doc = render('Europe/London');
    expect(doc.querySelector('#account-zone')!.closest('[data-v2-addition]')).not.toBeNull();
    const entry = SETTINGS_ADDITIONS.find((a) => a.source.startsWith('D-17'));
    expect(entry?.screen).toBe('settings');
  });
});
