/**
 * `supabaseMintDeps`: which client each dependency uses, and `report_minted` through the real
 * `captureServerEvent`, read at a stubbed fetch, so the consent gate is the one that ships.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fixture } from '../fixtures';
import { FIRST_AUDIT } from '../view/segment/test-helpers';
import { buildPublicSnapshot } from './build-snapshot';

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstileToken: vi.fn() }));
const loaded = vi.hoisted(() => ({ reader: null as unknown }));
vi.mock('@/lib/v2/pipeline/load', async () => {
  const { fixture: f } = await import('../fixtures');
  return {
    supabaseCheckReader: (sb: unknown) => ({ sb }),
    loadCheck: async (reader: unknown) => {
      loaded.reader = reader;
      return f('bad-site');
    },
  };
});

const { supabaseMintDeps } = await import('./mint-deps');

const CHECK = FIRST_AUDIT['bad-site'];
let calls: string[];

/** A client that records `<name>.<table>.<method>` and answers `answer`. */
function client(name: string, answer: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'insert'])
    chain[m] = (...args: unknown[]) => {
      calls.push(
        `${name}.${m}${m === 'insert' ? `:${Object.keys(args[0] as object).join(',')}` : ''}`,
      );
      return m === 'insert' ? Promise.resolve({ error: null }) : chain;
    };
  chain.maybeSingle = async () => answer;
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from: (table: string) => {
      calls.push(`${name}.from:${table}`);
      return chain;
    },
    rpc: async (fn: string, args: unknown) => {
      calls.push(`${name}.rpc:${fn}:${JSON.stringify(args)}`);
      return answer;
    },
  } as unknown as SupabaseClient;
}

const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

beforeEach(() => {
  calls = [];
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('supabaseMintDeps', () => {
  it('reads the user, the check and the membership through the caller’s session', async () => {
    const session = client('session', {
      data: { site_id: 'site-1', status: 'finished' },
      error: null,
    });
    const deps = supabaseMintDeps(session, client('admin', { data: null, error: null }), null);
    expect(await deps.user()).toEqual({ id: 'u-1' });
    expect(await deps.checkAsCaller(CHECK)).toEqual({ siteId: 'site-1', status: 'finished' });
    await deps.isMemberForSite('site-1');
    expect(calls).toEqual([
      'session.from:checks',
      'session.select',
      'session.eq',
      'session.rpc:is_member_for_site:{"p_site":"site-1"}',
    ]);
  });

  it('a membership answer other than true is not a member', async () => {
    for (const data of [false, null, 'true']) {
      const deps = supabaseMintDeps(
        client('session', { data, error: null }),
        client('admin', { data: null, error: null }),
        null,
      );
      expect(await deps.isMemberForSite('site-1')).toBe(false);
    }
    const failing = supabaseMintDeps(
      client('session', { data: null, error: { message: 'boom' } }),
      client('admin', { data: null, error: null }),
      null,
    );
    await expect(failing.isMemberForSite('site-1')).rejects.toThrow(/is_member_for_site/);
  });

  it('reads the existing report, the dataset and writes the row with the service role', async () => {
    const admin = client('admin', { data: { slug: 'first' }, error: null });
    const deps = supabaseMintDeps(client('session', { data: null, error: null }), admin, null);
    expect(await deps.slugForCheck(CHECK)).toBe('first');
    const at = '2026-11-12T18:00:00.000Z';
    const { snapshot, accountId } = await deps.snapshotOf(CHECK, at);
    expect(loaded.reader).toEqual({ sb: admin });
    expect(snapshot).toEqual(buildPublicSnapshot(fixture('bad-site'), CHECK, at));
    expect(accountId).toBe(fixture('bad-site').sites[0]!.account_id);
    await deps.insert({
      slug: 's',
      audit_id: null,
      check_id: CHECK,
      site_id: 'site-1',
      account_id: 'a',
      domain: 'example-outfitter.com',
      report_snapshot: snapshot,
      minted_by: 'u-1',
    });
    expect(calls).toEqual([
      'admin.from:public_reports',
      'admin.select',
      'admin.eq',
      'admin.from:public_reports',
      'admin.insert:slug,audit_id,check_id,site_id,account_id,domain,report_snapshot,minted_by',
    ]);
  });

  it('sends report_minted {kind: v2} keyed by the account when the visitor’s consent allows', async () => {
    const quiet = client('x', { data: null, error: null });
    await supabaseMintDeps(quiet, quiet, 'cm_consent=granted').reportMinted('acct-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      event: 'report_minted',
      distinct_id: 'account:acct-1',
      properties: { kind: 'v2' },
    });
  });

  it('sends nothing when the visitor declined', async () => {
    const quiet = client('x', { data: null, error: null });
    await supabaseMintDeps(quiet, quiet, 'cm_consent=denied').reportMinted('acct-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
