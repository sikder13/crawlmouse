/**
 * The header knows the session (CC-39 D2, walk-findings items 2 and 5): a signed-in reader is offered
 * the signed-in shell's first rail entry (Sites, the dashboard) where the header said "Log in"; a
 * reader not known to be signed in still gets Log in. On an audit page "signed in" is a kept audit,
 * which only a member of its account can read.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FixScreen } from '../../components/v2/screens/fix/FixScreen';
import { PricingScreen } from '../../components/v2/screens/pricing/PricingScreen';
import { ResultShell } from '../../components/v2/screens/result/ResultScreen';
import {
  pricingSignedIn,
  pricingSignedOut,
} from '../../app/(v2-preview)/v2-preview/_preview/pricing';
import { fixture } from '../../lib/v2/fixtures';
import { ACCOUNT_NAV } from '../../lib/v2/view/account-actions';
import { fixView } from '../../lib/v2/view/fix';
import { FIRST_AUDIT } from '../../lib/v2/view/segment/test-helpers';

/** The header's links, as [label, href]. */
const headerLinks = (html: string) => {
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  return [...header.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)</g)].map(([, href, label]) => [
    label,
    href,
  ]);
};
const SITES = [ACCOUNT_NAV[0].label, ACCOUNT_NAV[0].href];
const LOG_IN = ['Log in', '/login'];

describe('the audit pages’ header', () => {
  it('a signed-in reader: Sites, and no Log in', () => {
    const links = headerLinks(renderToStaticMarkup(<ResultShell signedIn>{null}</ResultShell>));
    expect(links).toContainEqual(SITES);
    expect(links).not.toContainEqual(LOG_IN);
  });

  it('otherwise: Log in', () => {
    const links = headerLinks(renderToStaticMarkup(<ResultShell>{null}</ResultShell>));
    expect(links).toContainEqual(LOG_IN);
    expect(links).not.toContainEqual(SITES);
  });

  const d = fixture('bad-site');
  const check = FIRST_AUDIT['bad-site'];
  const fixId = d.fixes.find((f) => f.number === 2 && f.site_id === d.sites[0]!.id)!.id;

  it('the fix page of a kept audit is a signed-in page, and links Mark done to its site', () => {
    const v = fixView(d, check, fixId, { rerun: false });
    const html = renderToStaticMarkup(<FixScreen data={v} />);
    expect(headerLinks(html)).toContainEqual(SITES);
    expect(headerLinks(html)).not.toContainEqual(LOG_IN);
    expect(html).toContain(`href="/sites/${d.sites[0]!.id}"`);
    expect(html).toContain('Mark it done on the site page');
  });

  it('the fix page of an audit nobody keeps still offers Log in', () => {
    const v = fixView(d, check, fixId, { asFirstSeen: true, rerun: false });
    expect(headerLinks(renderToStaticMarkup(<FixScreen data={v} />))).toContainEqual(LOG_IN);
  });
});

describe('the Pricing header', () => {
  it('signed in: Sites, and no Log in', () => {
    const links = headerLinks(renderToStaticMarkup(<PricingScreen view={pricingSignedIn()} />));
    expect(links).toContainEqual(SITES);
    expect(links).not.toContainEqual(LOG_IN);
  });

  it('signed out: Log in', () => {
    const links = headerLinks(renderToStaticMarkup(<PricingScreen view={pricingSignedOut()} />));
    expect(links).toContainEqual(LOG_IN);
    expect(links).not.toContainEqual(SITES);
  });
});
