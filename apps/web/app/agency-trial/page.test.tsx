/**
 * /agency-trial (CC-29 D3): a 404 unless V2_BILLING is on, before any read; signed out, a redirect to
 * sign in that returns here; never indexed; the form for a new trialist, the reason and no form for
 * a used trial, and the "did not finish" note for an agency account a Checkout left (Q16).
 */
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgencyAccountRow } from '@/lib/v2/view/agency-trial';

const h = vi.hoisted(() => ({
  reads: 0,
  viewer: { kind: 'signed_out' } as Record<string, unknown>,
  rows: [] as unknown[],
  used: null as unknown,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({}) }));
vi.mock('@/lib/v2/account/viewer', () => ({
  loadViewer: async () => {
    h.reads += 1;
    return h.viewer;
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/v2/pricing/read', () => ({ readAgencyAccounts: async () => h.rows }));
vi.mock('@/lib/billing/portal-v2', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/portal-v2')>()),
  supabasePortalAccounts: () => ({ customerOf: async () => 'cus_1' }),
}));
vi.mock('@/lib/v2/pricing/used-trial', () => ({ readUsedAgencyTrial: async () => h.used }));

import AgencyTrialPage, { dynamic, metadata } from './page';

const render = (searchParams: Record<string, string> = {}) =>
  AgencyTrialPage({ searchParams: Promise.resolve(searchParams) }) as Promise<ReactElement>;

const signedIn = {
  kind: 'viewer',
  viewer: { userId: 'u1', email: 'me@summit.agency', account: { timezone: 'UTC' } },
};

const agencyRow = (over: Partial<AgencyAccountRow>): AgencyAccountRow => ({
  id: 'a0000000-0000-4000-8000-00000000000b',
  role: 'owner',
  name: 'Summit Digital',
  state: 'free',
  tier: 'free',
  pastDueTier: null,
  pastDueSince: null,
  trialVariant: null,
  trialEndsAt: null,
  trialUsedAt: null,
  subscriptionId: null,
  billingEnd: null,
  firstSite: 'clientsite.com',
  ...over,
});

beforeEach(() => {
  h.reads = 0;
  h.viewer = { kind: 'signed_out' };
  h.rows = [];
  h.used = null;
  vi.stubEnv('V2_BILLING', '1');
});
afterEach(() => vi.unstubAllEnvs());

describe('/agency-trial', () => {
  it.each(['', 'true'])('is a 404 with V2_BILLING=%j, before any read', async (flag) => {
    vi.stubEnv('V2_BILLING', flag);
    await expect(render()).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK;404'),
    });
    expect(h.reads).toBe(0);
  });

  it.each([
    [{}, '/login?next=%2Fagency-trial'],
    [{ interval: 'year' }, '/login?next=%2Fagency-trial%3Finterval%3Dyear'],
  ])('signed out (%j): sent to sign in, and back', async (params, location) => {
    await expect(render(params)).rejects.toMatchObject({
      digest: expect.stringContaining(`NEXT_REDIRECT;replace;${location};`),
    });
  });

  it('is never indexed, has no canonical, and renders per request', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates?.canonical).toBeNull();
    expect(dynamic).toBe('force-dynamic');
  });

  it('a new trialist: the form, with the consent box, the agency name and the first client site', async () => {
    h.viewer = signedIn;
    const html = renderToStaticMarkup(await render());
    expect(html).toContain('Start your Agency trial.');
    expect(html).toContain('Signed in as <strong>me@summit.agency</strong>');
    const consent = html.match(/<input[^>]*name="consent"[^>]*>/)?.[0] ?? '';
    for (const attr of ['type="checkbox"', 'value="true"', 'required=""'])
      expect(consent).toContain(attr);
    expect(html).toContain('name="agencyName"');
    expect(html).toContain('name="site"');
    expect(html).toContain('action="/api/agency-trial"');
    expect(html).not.toContain('did not finish');
    expect(html.match(/data-v2-primary/g)).toHaveLength(1);
  });

  it('a Checkout that did not finish: the note, and what was typed', async () => {
    h.viewer = signedIn;
    h.rows = [agencyRow({})];
    const html = renderToStaticMarkup(await render());
    expect(html).toContain('did not finish');
    expect(html).toContain('value="Summit Digital"');
    expect(html).toContain('value="clientsite.com"');
  });

  it.each([
    ['a live account', [agencyRow({ trialUsedAt: new Date('2026-10-01T10:00:00Z') })], false],
    // N5: the function counts a deleted account's used trial, which no live row shows.
    ['a deleted account', [], true],
  ] as const)('a used trial on %s: the reason and no form', async (_, rows, deleted) => {
    h.viewer = signedIn;
    h.rows = [...rows];
    h.used = {
      accountId: 'a0000000-0000-4000-8000-00000000000b',
      trialUsedAt: new Date('2026-10-01T10:00:00Z'),
      deleted,
    };
    const html = renderToStaticMarkup(await render());
    expect(html).toContain('Your Agency trial was used.');
    expect(html).not.toContain('<form');
  });

  // Q26: the trialist cancels the agency account here, before day 15, without CC-31's switcher.
  it('an agency trial owned: Manage billing and Cancel name that account, in two clicks', async () => {
    h.viewer = signedIn;
    const id = 'a0000000-0000-4000-8000-00000000000b';
    h.rows = [
      agencyRow({
        state: 'agency_trial',
        tier: 'agency',
        trialVariant: 'card_required',
        trialEndsAt: new Date('2099-01-01T00:00:00Z'),
        trialUsedAt: new Date('2026-10-01T10:00:00Z'),
        subscriptionId: 'sub_1',
      }),
    ];
    h.used = { accountId: id, trialUsedAt: new Date('2026-10-01T10:00:00Z'), deleted: false };
    const forms = (html: string) =>
      [...new JSDOM(html).window.document.querySelectorAll('form')].map((f) => ({
        method: f.getAttribute('method'),
        action: f.getAttribute('action'),
        fields: Object.fromEntries(
          [...f.querySelectorAll('input[type="hidden"]')].map((i) => [
            i.getAttribute('name'),
            i.getAttribute('value'),
          ]),
        ),
      }));
    const first = renderToStaticMarkup(await render());
    expect(first).toContain('You already have Agency.');
    expect(forms(first)).toEqual([
      { method: 'post', action: '/api/billing/portal', fields: { accountId: id } },
      { method: 'get', action: '/agency-trial', fields: { cancel: id } },
    ]);
    const second = renderToStaticMarkup(await render({ cancel: id }));
    expect(forms(second)).toEqual([
      { method: 'post', action: '/api/billing/portal', fields: { accountId: id } },
      { method: 'post', action: '/api/billing/cancel', fields: { accountId: id, confirm: 'true' } },
    ]);
  });

  // Correctness B-r2-1: after "Yes, cancel" the account stays on the trial with cancel_at_period_end
  // set; back on this page it says the card is not charged and offers no Cancel, asked or not.
  it('an agency trial set to cancel: not charged, and no Cancel, even with ?cancel=<id>', async () => {
    h.viewer = signedIn;
    const id = 'a0000000-0000-4000-8000-00000000000b';
    h.rows = [
      agencyRow({
        state: 'agency_trial',
        tier: 'agency',
        trialVariant: 'card_required',
        trialEndsAt: new Date('2099-01-01T00:00:00Z'),
        trialUsedAt: new Date('2026-10-01T10:00:00Z'),
        subscriptionId: 'sub_1',
        billingEnd: new Date('2099-01-01T00:00:00Z'),
      }),
    ];
    h.used = { accountId: id, trialUsedAt: new Date('2026-10-01T10:00:00Z'), deleted: false };
    for (const params of [{}, { cancel: id }] as Record<string, string>[]) {
      const html = renderToStaticMarkup(await render(params));
      expect(html).toContain('Cancelled; the trial ends Thu 1 Jan and the card is not charged.');
      expect(html).not.toContain('charged when it ends');
      const actions = [...new JSDOM(html).window.document.querySelectorAll('form')].map((f) =>
        f.getAttribute('action'),
      );
      expect(actions).toEqual(['/api/billing/portal']);
    }
  });
});
