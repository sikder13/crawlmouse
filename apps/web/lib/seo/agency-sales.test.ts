/**
 * F-251: a public surface offers Agency for sale only when billing is public AND Agency sales are
 * open (V2_AGENCY_SALES). With billing public and Agency closed, the checkout refuses Agency and
 * `/agency-trial` redirects, so llms.txt, the home page's JSON-LD and /agencies must not sell it.
 * Each case stubs the env and re-imports, as the page and route read it.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agenciesView } from '../v2/view/agencies';

// /agencies and /llms.txt read the Goal 1 switch (`lib/feature-switch.ts`, 'server-only').
vi.mock('server-only', () => ({}));
vi.mock('../fonts', () => ({
  fraunces: { variable: '' },
  geist: { variable: '' },
  geistMono: { variable: '' },
}));

/** [V2_BILLING, V2_BILLING_ONLY_USER, V2_AGENCY_SALES] → whether Agency is on sale. */
const CASES = [
  ['1', '', '1', true],
  ['1', '', '', false],
  ['1', '', '0', false],
  ['', '', '1', false],
  ['', '', '', false],
  ['1', 'owner-user-id', '1', false],
] as const;

function stub(billing: string, only: string, agency: string) {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('V2_ACCOUNT_DOOR', '1');
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');
  vi.stubEnv('V2_BILLING', billing);
  vi.stubEnv('V2_BILLING_ONLY_USER', only);
  vi.stubEnv('V2_AGENCY_SALES', agency);
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllEnvs());

describe.each(CASES)(
  'V2_BILLING=%j, V2_BILLING_ONLY_USER=%j, V2_AGENCY_SALES=%j',
  (billing, only, agency, onSale) => {
    beforeEach(() => stub(billing, only, agency));

    it(`plansLine ${onSale ? 'lists' : 'does not list'} Agency`, async () => {
      const { plansLine } = await import('./llms-v2');
      if (onSale) {
        expect(plansLine()).toBe(
          'Plans: Free; Pro $19/month or $190/year; Agency $99/month or $990/year.',
        );
      } else {
        expect(plansLine()).toBe('Plans: Free; Pro $19/month or $190/year.');
      }
    });

    it(`planOffers ${onSale ? 'offers' : 'does not offer'} Agency`, async () => {
      const { planOffers } = await import('./jsonld');
      expect(planOffers().map((o) => o.name)).toEqual([
        'Free',
        'Pro, monthly',
        'Pro, yearly',
        ...(onSale ? ['Agency, monthly', 'Agency, yearly'] : []),
      ]);
    });

    it(`/llms.txt ${onSale ? 'lists' : 'does not list'} Agency among the plans`, async () => {
      const { GET } = await import('../../app/llms.txt/route');
      const body = await GET().text();
      expect(body).toContain('\nPlans: Free; Pro $19/month or $190/year');
      expect(/\nPlans: [^\n]*Agency/.test(body)).toBe(onSale);
      const agenciesLine = body.split('\n').find((l) => l.includes('/agencies)'))!;
      expect(/trial/.test(agenciesLine) && !/opens soon/.test(agenciesLine)).toBe(onSale);
    }, 60_000);

    it(`/agencies ${onSale ? 'offers' : 'does not offer'} the Agency trial`, async () => {
      const page = await import('../../app/agencies/page');
      const html = renderToStaticMarkup(page.default());
      expect(html.includes('href="/agency-trial"')).toBe(onSale);
      expect(/Card required/.test(html)).toBe(onSale);
      expect(String(page.metadata.description).includes('-day trial')).toBe(onSale);
    }, 60_000);
  },
);

describe('agenciesView follows Agency sales, not billing alone', () => {
  const views = (accountDoor: boolean) => ({
    open: agenciesView({ billing: true, agencySales: true, accountDoor }),
    closed: agenciesView({ billing: true, agencySales: false, accountDoor }),
    off: agenciesView({ billing: false, agencySales: false, accountDoor }),
    offSales: agenciesView({ billing: false, agencySales: true, accountDoor }),
  });

  it.each([true, false])(
    'account door %j: billing on, Agency closed reads as billing off',
    (door) => {
      const v = views(door);
      expect(v.closed.trial.href).not.toMatch(/agency-trial/);
      expect(v.closed.description).not.toMatch(/-day trial/);
      expect(v.closed.opensSoon).not.toBeNull();
      expect(v.closed).toEqual(v.off);
    },
  );

  it.each([true, false])('account door %j: billing off ignores Agency sales', (door) => {
    const v = views(door);
    expect(v.offSales).toEqual(v.off);
  });

  it('with both open, the trial is offered', () => {
    const v = views(true);
    expect(v.open.trial.href).toBe('/agency-trial');
    expect(v.open.opensSoon).toBeNull();
    expect(v.open.description).toMatch(/-day trial/);
  });
});
