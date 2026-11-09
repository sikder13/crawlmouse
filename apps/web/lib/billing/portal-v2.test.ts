import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePortal, portalV2, supabasePortalAccounts, type PortalDeps } from './portal-v2';

const ACCOUNT = '0b8c6f8e-3c55-4d1b-9a7a-2f0c4f9d6c11';
const ORIGIN = 'https://crawlmouse.com';
const PORTAL_URL = 'https://billing.stripe.com/p/session/test_v2';

let customer: string | null;
const create = vi.fn();
const configuration = vi.fn();

const deps = (): PortalDeps => ({
  accounts: { customerOf: async () => customer },
  configuration,
  origin: ORIGIN,
  stripe: { billingPortal: { sessions: { create } } },
});

beforeEach(() => {
  customer = 'cus_1';
  create.mockReset().mockResolvedValue({ url: PORTAL_URL });
  configuration.mockReset().mockResolvedValue('bpc_ours');
});

describe('parsePortal', () => {
  it.each([
    [{}, {}],
    [{ accountId: ACCOUNT }, { accountId: ACCOUNT }],
  ])('reads %j', (fields, input) => {
    expect(parsePortal({ kind: 'form', fields })).toEqual(input);
  });

  it.each([
    [{ accountId: 'x' }],
    [{ customer: 'cus_other' }],
    [{ return_url: 'https://evil.example' }],
  ])('refuses %j', (fields) => {
    expect(parsePortal({ kind: 'json', fields })).toBeNull();
  });
});

describe('portalV2', () => {
  it("400 no_customer (v1's shape) for an account Stripe does not know, with no Stripe call", async () => {
    customer = null;
    expect(await portalV2(deps(), ACCOUNT)).toEqual({
      ok: false,
      status: 400,
      error: 'no_customer',
    });
    expect(configuration).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("opens the account's portal on v2's configuration, returning to Settings › Plan", async () => {
    expect(await portalV2(deps(), ACCOUNT)).toEqual({ ok: true, url: PORTAL_URL });
    expect(create.mock.calls).toEqual([
      [{ customer: 'cus_1', configuration: 'bpc_ours', return_url: `${ORIGIN}/settings/plan` }],
    ]);
  });
});

describe('supabasePortalAccounts', () => {
  function admin(result: { data: unknown; error: unknown }) {
    const calls: unknown[][] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) {
      chain[m] = (...args: unknown[]) => {
        calls.push([m, ...args]);
        return chain;
      };
    }
    chain.maybeSingle = () => {
      calls.push(['maybeSingle']);
      return Promise.resolve(result);
    };
    const sb = {
      from: (table: string) => {
        calls.push(['from', table]);
        return chain;
      },
    } as unknown as SupabaseClient;
    return { sb, calls };
  }

  it("reads the account's Stripe customer", async () => {
    const { sb, calls } = admin({ data: { stripe_customer_id: 'cus_1' }, error: null });
    expect(await supabasePortalAccounts(sb).customerOf(ACCOUNT)).toBe('cus_1');
    expect(calls).toEqual([
      ['from', 'accounts'],
      ['select', 'stripe_customer_id'],
      ['eq', 'id', ACCOUNT],
      ['maybeSingle'],
    ]);
  });

  it('answers null for an account with no customer', async () => {
    const { sb } = admin({ data: { stripe_customer_id: null }, error: null });
    expect(await supabasePortalAccounts(sb).customerOf(ACCOUNT)).toBeNull();
  });

  it('throws on a failed read, or an account that is not there', async () => {
    await expect(
      supabasePortalAccounts(admin({ data: null, error: { message: 'boom' } }).sb).customerOf(
        ACCOUNT,
      ),
    ).rejects.toThrow('accounts read failed: boom');
    await expect(
      supabasePortalAccounts(admin({ data: null, error: null }).sb).customerOf(ACCOUNT),
    ).rejects.toThrow(`account ${ACCOUNT} not found`);
  });
});
