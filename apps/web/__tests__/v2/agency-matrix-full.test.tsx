/**
 * F-239 (row 9): at 25 of Agency's 25 client sites, where no more can be bought (Northwind is past
 * due at the fixture's as_of), the matrix drew no add form and said nothing of why. Rendered, the
 * reason now stands where the form was, and the form is gone.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FixtureDataset } from '@crawlmouse/types/v2';
import { MatrixScreen } from '../../components/v2/screens/agency/MatrixScreen';
import {
  ACCOUNT_VIEWERS,
  NORTHWIND_ACCOUNT_ID,
} from '../../app/(v2-preview)/v2-preview/_preview/accounts';
import { HARBORLIGHT_SITE } from '../../app/(v2-preview)/v2-preview/_preview/agency';
import { GATES } from '../../lib/entitlement-v2';
import { fixture } from '../../lib/v2/fixtures';
import { agencyHomeView } from '../../lib/v2/view/agency-matrix';

const d = fixture('challenged-site');
const northwind = ACCOUNT_VIEWERS.withheld();

function withClients(k: number): FixtureDataset {
  const base = d.sites.find((s) => s.id === HARBORLIGHT_SITE)!;
  const extra = Array.from({ length: k - 2 }, (_, i) => ({
    ...base,
    id: `50000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`,
    host: `client-${i + 3}.example`,
    client_name: null,
  }));
  return {
    ...d,
    sites: [...d.sites, ...extra],
    accounts: d.accounts.map((a) =>
      a.id === NORTHWIND_ACCOUNT_ID
        ? { ...a, limits: { ...a.limits, sites: GATES.agency.sites } }
        : a,
    ),
  };
}

const html = (k: number) =>
  renderToStaticMarkup(<MatrixScreen data={agencyHomeView(withClients(k), northwind)} />);

describe('the full client matrix says why no client can be added (F-239)', () => {
  it('at 25 of 25: the reason in the form’s place, and no form', () => {
    const page = html(25);
    expect(page).toContain(
      'data-v2-full="">This plan holds 25 client sites, and 25 are kept. To add a client, remove one first.</p>',
    );
    expect(page).not.toContain('action="/api/sites"');
    expect(page).not.toContain('Add a client site');
  });

  it('at 24 of 25: the form, and no reason', () => {
    const page = html(24);
    expect(page).toContain('Add a client site · 24 of 25');
    expect(page).not.toContain('data-v2-full');
  });
});
