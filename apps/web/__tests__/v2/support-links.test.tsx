/**
 * The support links inside the product (CC-33 D5): Settings' "Email support", with the account's id
 * and the page's path, and the fix page's "Something wrong with this fix?", with the ids the fix page
 * passes. Each is the builder's mailto and is marked as an addition to the locked screen.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FixScreen } from '../../components/v2/screens/fix/FixScreen';
import { SettingsScreen } from '../../components/v2/screens/settings/SettingsScreen';
import { settingsPreview } from '../../app/(v2-preview)/v2-preview/_preview/screens';
import { fixPreview } from '../../app/(v2-preview)/v2-preview/_preview/fixes';
import { ACCOUNT_VIEWERS } from '../../app/(v2-preview)/v2-preview/_preview/accounts';
import { SUPPORT_COPY } from '../../lib/v2/copy/support';
import { supportMailto } from '../../lib/v2/support/mailto';

const escaped = (s: string) => s.replace(/&/g, '&amp;');

/** The `data-v2-addition` paragraph holding a link with this text, and that link's href. */
function additionLink(html: string, text: string): string | null {
  const m = new RegExp(
    `<p [^>]*data-v2-addition=""[^>]*>[^<]*<a href="([^"]*)"[^>]*>${text}</a>`,
  ).exec(html);
  return m ? m[1]!.replace(/&amp;/g, '&') : null;
}

describe('Settings’ support link', () => {
  it.each(['home', 'clean'] as const)('%s: the builder’s mailto with the account id', (name) => {
    const data = settingsPreview(name);
    const { accountId } = ACCOUNT_VIEWERS[name]();
    const expected = supportMailto({ topic: 'general', accountId, path: '/settings' });
    expect(data.support.href).toBe(expected);
    expect(decodeURIComponent(expected)).toContain(`Account: ${accountId}`);
    const html = renderToStaticMarkup(<SettingsScreen data={data} />);
    expect(html).toContain(escaped(SUPPORT_COPY.settings.lead));
    expect(additionLink(html, SUPPORT_COPY.settings.link)).toBe(expected);
  });
});

describe('the fix page’s support link', () => {
  const href = supportMailto({
    topic: 'fix',
    path: '/audit/0b0e7a52-5f0b-4b53-9c0e-0d4a3a1f2c11/fix/a0000000-0000-4000-8000-00000000000a',
    fixId: 'a0000000-0000-4000-8000-00000000000a',
    fixType: 'orphan_pages',
  });

  it('renders the link it is given, as an addition', () => {
    const html = renderToStaticMarkup(<FixScreen data={fixPreview('bad-site')} support={href} />);
    expect(html).toContain(escaped(SUPPORT_COPY.fix.lead));
    expect(additionLink(html, SUPPORT_COPY.fix.link)).toBe(href);
  });

  it('renders no link when it is given none, as the previews are', () => {
    const html = renderToStaticMarkup(<FixScreen data={fixPreview('bad-site')} />);
    expect(html).not.toContain(SUPPORT_COPY.fix.link);
    expect(html).not.toContain('mailto:');
  });
});
