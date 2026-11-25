import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  checkDomain,
  claimDomain,
  removeDomain,
  txtHolds,
  type DomainDeps,
  type DomainPatch,
  type DomainRow,
  type DomainStore,
} from './domain';
import type { VercelDomains, VercelResult } from './vercel-domains';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const HOST = 'reports.agency-example.com';
const T = '2026-11-25T12:00:00.000Z';

/** `agency_brands` in memory, with the unique host the table enforces. */
function memoryStore(brands: string[]) {
  const rows = new Map<string, DomainRow | null>(brands.map((a) => [a, null]));
  const store: DomainStore = {
    async read(a) {
      return rows.has(a) ? (rows.get(a) ?? null) : 'no_brand';
    },
    async claim(a, host, token) {
      if (!rows.has(a)) return 'no_brand';
      if (rows.get(a)) return 'has_host';
      if ([...rows.values()].some((r) => r?.host === host)) return 'in_use';
      rows.set(a, {
        host,
        status: 'unverified',
        txtToken: token,
        txtVerifiedAt: null,
        cnameFound: false,
        certificateAt: null,
        vercelAddedAt: null,
      });
      return 'claimed';
    },
    async update(a, host, patch: DomainPatch) {
      const r = rows.get(a);
      if (!r || r.host !== host) return false;
      rows.set(a, { ...r, ...patch });
      return true;
    },
    async clear(a, host) {
      const r = rows.get(a);
      if (!r || r.host !== host) return false;
      rows.set(a, null);
      return true;
    },
  };
  return { store, rows };
}

/** Vercel as a set of attached hosts, with knobs for what it answers. */
function fakeVercel(opts: { inUse?: boolean; verified?: boolean; configured?: boolean } = {}) {
  const attached = new Set<string>();
  const calls: string[] = [];
  const ok = <T>(value: T): VercelResult<T> => ({ ok: true, value });
  const state = () =>
    ok({
      verified: opts.verified ?? true,
      challenges:
        (opts.verified ?? true)
          ? []
          : [{ type: 'TXT', domain: '_vercel.agency-example.com', value: 'vc-domain-verify=x' }],
    });
  const vercel: VercelDomains = {
    async add(h) {
      calls.push(`add ${h}`);
      if (opts.inUse) return { ok: false, failure: 'in_use' };
      attached.add(h);
      return state();
    },
    async get(h) {
      calls.push(`get ${h}`);
      return attached.has(h) ? state() : { ok: false, failure: 'not_found' };
    },
    async verify(h) {
      calls.push(`verify ${h}`);
      return state();
    },
    async config(h) {
      calls.push(`config ${h}`);
      return ok({ configured: opts.configured ?? true, cname: 'abc.vercel-dns-017.com' });
    },
    async remove(h) {
      calls.push(`remove ${h}`);
      attached.delete(h);
      return ok(null);
    },
  };
  return { vercel, attached, calls, opts };
}

function deps(over: Partial<DomainDeps> & { txt?: Record<string, string[][]> } = {}) {
  const mem = memoryStore([A, B]);
  const v = fakeVercel();
  const txt = over.txt ?? {};
  const d: DomainDeps = {
    store: mem.store,
    vercel: v.vercel,
    vercelConfigured: true,
    resolveTxt: async (name) => {
      if (!(name in txt)) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
      return txt[name]!;
    },
    newToken: () => 'tok123',
    now: () => new Date(T),
    ...over,
  };
  return { d, mem, v, txt };
}

const PROVED = { [`_crawlmouse.${HOST}`]: [['crawlmouse-verify=tok123']] };

describe('claimDomain (row 25 b, c)', () => {
  it('stores a host the rules accept, unverified, and names the TXT record to add', async () => {
    const { d, mem, v } = deps();
    const a = await claimDomain(d, A, '  Reports.Agency-Example.com. ');
    expect(a).toEqual({
      ok: true,
      view: {
        host: HOST,
        status: 'unverified',
        txt: { name: `_crawlmouse.${HOST}`, value: 'crawlmouse-verify=tok123' },
        cname: null,
        vercelChallenges: [],
      },
    });
    expect(mem.rows.get(A)?.status).toBe('unverified');
    expect(v.calls).toEqual([]);
  });

  it('refuses a host the rules refuse, with the rule, and stores nothing', async () => {
    const { d, mem } = deps();
    for (const [host, reason] of [
      ['crawlmouse.com', 'apex'],
      ['x.crawlmouse.com', 'ours'],
      ['x.vercel.app', 'unknown_suffix'],
      ['10.0.0.1', 'ip'],
      ['agency-example.com', 'apex'],
    ] as const) {
      expect(await claimDomain(d, A, host)).toEqual({
        ok: false,
        status: 400,
        code: 'invalid_host',
        reason,
      });
    }
    expect(mem.rows.get(A)).toBeNull();
  });

  it('refuses a host another account holds, at any state', async () => {
    const { d } = deps();
    await claimDomain(d, A, HOST);
    expect(await claimDomain(d, B, HOST)).toMatchObject({ ok: false, status: 409, code: 'in_use' });
  });

  it('refuses a second host while one is held, and an account with no brand', async () => {
    const { d } = deps();
    await claimDomain(d, A, HOST);
    expect(await claimDomain(d, A, 'other.agency-example.com')).toMatchObject({ code: 'has_host' });
    const none = deps({ store: memoryStore([]).store });
    expect(await claimDomain(none.d, A, HOST)).toMatchObject({ code: 'no_brand' });
  });
});

describe('checkDomain: TXT first, then Vercel, then the CNAME (row 25 b)', () => {
  it('without the owner’s token, refuses before reading DNS or the row', async () => {
    const resolveTxt = vi.fn();
    const read = vi.fn();
    const { d } = deps({ vercelConfigured: false, resolveTxt });
    d.store = { ...d.store, read };
    expect(await checkDomain(d, A)).toEqual({
      ok: false,
      status: 503,
      code: 'domain_service_unconfigured',
    });
    expect(resolveTxt).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('never attaches a host whose TXT record is missing or wrong', async () => {
    for (const txt of [
      {},
      { [`_crawlmouse.${HOST}`]: [['crawlmouse-verify=other']] },
      { [`_crawlmouse.${HOST}`]: [['tok123']] },
      { [`_crawlmouse.other.${HOST}`]: [['crawlmouse-verify=tok123']] },
    ] as Record<string, string[][]>[]) {
      const { d, mem, v } = deps({ txt });
      await claimDomain(d, A, HOST);
      const a = await checkDomain(d, A);
      expect(a).toMatchObject({ ok: true, view: { status: 'unverified' } });
      expect(mem.rows.get(A)?.txtVerifiedAt).toBeNull();
      expect(v.calls).toEqual([]);
    }
  });

  it('with the TXT proved, attaches, and is verified once Vercel serves it', async () => {
    const { d, mem, v } = deps({ txt: PROVED });
    await claimDomain(d, A, HOST);
    const a = await checkDomain(d, A);
    expect(a).toMatchObject({
      ok: true,
      view: { status: 'verified', cname: 'abc.vercel-dns-017.com' },
    });
    expect(v.calls).toEqual([`add ${HOST}`, `config ${HOST}`]);
    expect(mem.rows.get(A)).toMatchObject({
      status: 'verified',
      txtVerifiedAt: T,
      vercelAddedAt: T,
      cnameFound: true,
      certificateAt: T,
    });
  });

  it('a TXT record split into strings, as long records are, still matches', async () => {
    expect(await txtHolds(async () => [['crawlmouse-', 'verify=tok123']], HOST, 'tok123')).toBe(
      true,
    );
  });

  it('stays pending while the CNAME is not in place, and names it', async () => {
    const { d, mem, v } = deps({ txt: PROVED });
    v.opts.configured = false;
    await claimDomain(d, A, HOST);
    expect(await checkDomain(d, A)).toMatchObject({
      ok: true,
      view: { status: 'pending', cname: 'abc.vercel-dns-017.com' },
    });
    expect(mem.rows.get(A)?.status).toBe('pending');
    v.opts.configured = true;
    expect(await checkDomain(d, A)).toMatchObject({ view: { status: 'verified' } });
    expect(v.calls.filter((c) => c.startsWith('add'))).toHaveLength(1);
  });

  it('stops serving a verified host whose CNAME no longer points at us', async () => {
    const { d, mem, v } = deps({ txt: PROVED });
    await claimDomain(d, A, HOST);
    await checkDomain(d, A);
    v.opts.configured = false;
    expect(await checkDomain(d, A)).toMatchObject({ view: { status: 'pending' } });
    expect(mem.rows.get(A)).toMatchObject({
      status: 'pending',
      cnameFound: false,
      certificateAt: null,
    });
  });

  it('passes Vercel’s own challenge back while Vercel has not verified the host', async () => {
    const { d, mem, v } = deps({ txt: PROVED });
    v.opts.verified = false;
    await claimDomain(d, A, HOST);
    const a = await checkDomain(d, A);
    expect(a).toMatchObject({
      ok: true,
      view: {
        status: 'pending',
        vercelChallenges: [{ type: 'TXT', domain: '_vercel.agency-example.com' }],
      },
    });
    expect(v.calls).not.toContain(`config ${HOST}`);
    expect(mem.rows.get(A)?.status).toBe('pending');
  });

  it('marks the host an error when another Vercel project holds it', async () => {
    const { d, mem, v } = deps({ txt: PROVED });
    v.opts.inUse = true;
    await claimDomain(d, A, HOST);
    expect(await checkDomain(d, A)).toEqual({ ok: false, status: 409, code: 'in_use' });
    expect(mem.rows.get(A)).toMatchObject({ status: 'error', vercelAddedAt: null });
  });

  it('takes the host back off Vercel when the row changed while it was being attached', async () => {
    const { d, mem, v } = deps({ txt: PROVED });
    await claimDomain(d, A, HOST);
    const update = d.store.update.bind(d.store);
    d.store.update = async (a, h, p) => {
      if (p.vercelAddedAt !== undefined) {
        mem.rows.set(A, null);
        return false;
      }
      return update(a, h, p);
    };
    expect(await checkDomain(d, A)).toMatchObject({ ok: false, status: 409, code: 'changed' });
    expect(v.attached.has(HOST)).toBe(false);
    expect(v.calls).toEqual([`add ${HOST}`, `remove ${HOST}`]);
  });

  it('is a 404 for an account with no host', async () => {
    const { d } = deps();
    expect(await checkDomain(d, A)).toMatchObject({ ok: false, status: 404, code: 'no_host' });
  });
});

describe('removeDomain', () => {
  it('takes the host off Vercel before it clears the row', async () => {
    const { d, mem, v } = deps({ txt: PROVED });
    await claimDomain(d, A, HOST);
    await checkDomain(d, A);
    const order: string[] = [];
    const clear = d.store.clear.bind(d.store);
    d.store.clear = async (a, h) => {
      order.push('clear');
      return clear(a, h);
    };
    const remove = v.vercel.remove;
    v.vercel.remove = async (h) => {
      order.push('remove');
      return remove(h);
    };
    expect(await removeDomain(d, A)).toMatchObject({ ok: true, view: { host: HOST, txt: null } });
    expect(order).toEqual(['remove', 'clear']);
    expect(v.attached.size).toBe(0);
    expect(mem.rows.get(A)).toBeNull();
  });

  it('keeps the row when Vercel refuses, and when the token is unset', async () => {
    const { d, mem, v } = deps({ txt: PROVED });
    await claimDomain(d, A, HOST);
    await checkDomain(d, A);
    v.vercel.remove = async () => ({ ok: false, failure: 'failed' });
    expect(await removeDomain(d, A)).toMatchObject({ ok: false, status: 502 });
    expect(mem.rows.get(A)?.host).toBe(HOST);
    d.vercelConfigured = false;
    expect(await removeDomain(d, A)).toMatchObject({ ok: false, status: 503 });
    expect(mem.rows.get(A)?.host).toBe(HOST);
  });

  it('clears a host never attached without calling Vercel, token or not', async () => {
    const { d, mem, v } = deps({ vercelConfigured: false });
    await claimDomain(d, A, HOST);
    expect(await removeDomain(d, A)).toMatchObject({ ok: true });
    expect(v.calls).toEqual([]);
    expect(mem.rows.get(A)).toBeNull();
  });
});
