/**
 * Settings against Final-Settings: the visible text outside the rail equals the locked HTML with the
 * registered changes applied (lib/v2/copy/settings.ts) and nothing else; one orange element, Save;
 * every form posts to a known route and is stopped; the email field is filled from the account.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsScreen } from '../../components/v2/screens/settings/SettingsScreen';
import { settingsPreview } from '../../app/(v2-preview)/v2-preview/_preview/screens';
import { ACCOUNT_ACTIONS } from '../../lib/v2/view/account-actions';
import { CC27B_ROUTES } from '../../lib/v2/view/settings';
import { expected, firstDifference, locked, renderedText, withoutShell } from './_lib/lock';

const render = (name: 'home' | 'clean') =>
  renderToStaticMarkup(<SettingsScreen data={settingsPreview(name)} />);
const primaries = (html: string) => html.match(/data-v2-primary=""/g) ?? [];
const main = (html: string) => html.slice(html.indexOf('<main'));
const ROUTES = [...Object.values(ACCOUNT_ACTIONS), ...Object.values(CC27B_ROUTES)].map(
  (a) => new RegExp(`^${a.route.replace(/\[\w+\]/g, '[^/]+')}$`),
);

describe('Settings against Final-Settings', () => {
  const html = render('home');

  it('reads as the locked HTML outside the rail, with each registered change and nothing else', () => {
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-Settings.dc.html')).rest, 'settings'),
        renderedText(withoutShell(html).rest),
      ),
    ).toBeNull();
  });

  it('marks Settings in the rail and has one orange element: Save', () => {
    expect(html).toMatch(/aria-current="page"[^>]*>Settings[ <]/);
    expect(primaries(html)).toHaveLength(1);
    expect(html).toMatch(/data-v2-primary=""[^>]*>Save</);
  });

  it('posts every form on the page to a route CC-26b or CC-27b owns, never with a GET', () => {
    const forms = [...main(html).matchAll(/<form [^>]*>/g)].map(([tag]) => [
      tag.match(/ method="([^"]+)"/)?.[1],
      tag.match(/ action="([^"]+)"/)?.[1],
    ]);
    // The account form, two email switches, Delete and Keep.
    expect(forms).toHaveLength(5);
    for (const [method, action] of forms) {
      expect(method).toBe('post');
      expect(
        ROUTES.some((r) => r.test(action!)),
        action,
      ).toBe(true);
    }
  });

  it('fills the address field from the account and ties each hint to its field', () => {
    const input = html.match(/<input [^>]*id="account-email"[^>]*>/)![0];
    expect(input).toContain('name="newEmail"');
    expect(input).toContain('value="you@company.com"');
    expect(input).toContain('aria-describedby="account-email-hint"');
    expect(html).toContain('id="account-email-hint"');
  });
});

describe('Settings, free', () => {
  it('has one orange element and no trial reminder date', () => {
    const html = render('clean');
    expect(primaries(html)).toHaveLength(1);
    expect(html).toContain('only during a trial');
  });
});
