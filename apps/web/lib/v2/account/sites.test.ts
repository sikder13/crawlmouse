/**
 * The site routes' input rules (CC-26b D6): a host as the engine admits it, and an edit body with
 * the paid rules of the site's own account.
 */
import { validateUrlOrThrow } from '@crawlmouse/engine';
import { describe, expect, it, vi } from 'vitest';
import { GATES, type Tier } from '../../entitlement-v2';
import { admittedHost, decideEdit, parseAddBody, parseEditBody } from './sites';

/** The engine's own guard, with DNS answered by `addresses`. */
const engineWith =
  (addresses: string[]) =>
  (url: string): Promise<unknown> =>
    validateUrlOrThrow(url, { resolver: async () => addresses });

const PUBLIC = engineWith(['93.184.215.14']);

describe('admittedHost', () => {
  it('canonicalises what a person types to the host the engine admits', async () => {
    for (const raw of ['Example.COM', ' https://example.com/some/path ', 'http://example.com.']) {
      expect(await admittedHost(raw, PUBLIC)).toEqual({ ok: true, host: 'example.com' });
    }
  });

  it('refuses a host that resolves to a private, loopback or link-local address', async () => {
    for (const address of ['10.0.0.7', '127.0.0.1', '169.254.169.254', '192.168.1.1', '::1']) {
      expect(await admittedHost('example.com', engineWith([address])), address).toEqual({
        ok: false,
        code: 'host_refused',
      });
    }
  });

  it('refuses what is not a host, before any lookup', async () => {
    const validate = vi.fn(PUBLIC);
    for (const raw of [
      '',
      'not a host',
      'ftp://example.com',
      'https://u:p@example.com',
      '10.0.0.1',
      7,
    ]) {
      expect(await admittedHost(raw, validate), String(raw)).toEqual({
        ok: false,
        code: 'invalid_host',
      });
    }
    expect(validate).not.toHaveBeenCalled();
  });
});

describe('parseAddBody', () => {
  it('takes exactly {url}', () => {
    expect(parseAddBody({ url: 'example.com' })).toEqual({ url: 'example.com' });
    expect(parseAddBody({})).toBeNull();
    expect(parseAddBody({ url: 'example.com', accountId: 'x' })).toBeNull();
    expect(parseAddBody({ url: 3 })).toBeNull();
  });
});

describe('parseEditBody', () => {
  it('takes JSON and the same fields posted as a form', () => {
    expect(parseEditBody({ schedule: 'weekly', dow: 2, hour: 9 })).toEqual({
      schedule: 'weekly',
      dow: 2,
      hour: 9,
    });
    expect(parseEditBody({ schedule: 'monthly', dow: '1', hour: '06' })).toEqual({
      schedule: 'monthly',
      dow: 1,
      hour: 6,
    });
    expect(parseEditBody({ competitorHosts: 'a.example, b.example\nc.example' })).toEqual({
      competitorHosts: ['a.example', 'b.example', 'c.example'],
    });
    expect(parseEditBody({ competitorHosts: [] })).toEqual({ competitorHosts: [] });
    expect(parseEditBody({ stagingUrl: '' })).toEqual({ stagingUrl: null });
    expect(parseEditBody({ schedule: 'none' })).toEqual({ schedule: 'none' });
  });

  it('a schedule of none ignores a day and hour sent beside it (a form without script sends both)', () => {
    expect(parseEditBody({ schedule: 'none', dow: '2', hour: '06' })).toEqual({ schedule: 'none' });
    expect(parseEditBody({ schedule: 'none', dow: 2 })).toEqual({ schedule: 'none' });
    // Still read, so a day or hour out of range is refused with none too.
    expect(parseEditBody({ schedule: 'none', dow: 9, hour: 3 })).toBeNull();
  });

  it('refuses anything else', () => {
    for (const body of [
      {},
      { schedule: 'weekly' },
      { schedule: 'weekly', dow: 2 },
      { dow: 2, hour: 3 },
      { schedule: 'daily', dow: 2, hour: 3 },
      { schedule: 'on_deploy' },
      { schedule: 'weekly', dow: 8, hour: 3 },
      { schedule: 'weekly', dow: 2, hour: 24 },
      { schedule: 'weekly', dow: '2.5', hour: 3 },
      { competitorHosts: 'x'.repeat(5000) },
      { host: 'evil.example' },
      { removed_at: null },
    ]) {
      expect(parseEditBody(body), JSON.stringify(body)).toBeNull();
    }
  });
});

const entitlement = (tier: Tier, competitorsPerSite = GATES[tier].competitorsPerSite) => ({
  gates: GATES[tier],
  limits: { sites: GATES[tier].sites, seats: GATES[tier].seats, competitorsPerSite },
});

const SITE = { host: 'shop.example', isStaging: false };

describe('decideEdit', () => {
  it('a weekly schedule needs a paid tier; monthly and none do not', async () => {
    const weekly = { schedule: 'weekly' as const, dow: 2, hour: 9 };
    expect(await decideEdit(weekly, SITE, entitlement('free'), PUBLIC)).toEqual({
      ok: false,
      status: 402,
      code: 'upgrade_required',
      gate: 'schedule',
    });
    expect(await decideEdit(weekly, SITE, entitlement('pro'), PUBLIC)).toEqual({
      ok: true,
      patch: { schedule: { cadence: 'weekly', iso_weekday: 2, hour_local: 9 } },
    });
    expect(
      await decideEdit({ schedule: 'monthly', dow: 1, hour: 6 }, SITE, entitlement('free'), PUBLIC),
    ).toEqual({
      ok: true,
      patch: { schedule: { cadence: 'monthly', iso_weekday: 1, hour_local: 6 } },
    });
    expect(await decideEdit({ schedule: 'none' }, SITE, entitlement('free'), PUBLIC)).toEqual({
      ok: true,
      patch: { schedule: null },
    });
  });

  it('competitors need a paid tier and fit the account’s competitor limit', async () => {
    const two = { competitorHosts: ['a.example', 'https://B.example/'] };
    expect(await decideEdit(two, SITE, entitlement('free'), PUBLIC)).toMatchObject({
      status: 402,
      gate: 'competitorsPerSite',
    });
    expect(await decideEdit(two, SITE, entitlement('pro'), PUBLIC)).toMatchObject({
      status: 402,
      gate: 'competitorsPerSite',
    });
    expect(await decideEdit(two, SITE, entitlement('agency'), PUBLIC)).toEqual({
      ok: true,
      patch: { competitor_hosts: ['a.example', 'b.example'] },
    });
    // The account's own stored limit, not the tier's default.
    expect(await decideEdit(two, SITE, entitlement('pro', 2), PUBLIC)).toMatchObject({ ok: true });
    // Clearing them is open to every tier.
    expect(await decideEdit({ competitorHosts: [] }, SITE, entitlement('free'), PUBLIC)).toEqual({
      ok: true,
      patch: { competitor_hosts: [] },
    });
  });

  it('competitor hosts are canonicalised, de-duplicated, never the site itself, and admitted by the engine', async () => {
    expect(
      await decideEdit(
        { competitorHosts: ['a.example', 'A.example', 'http://a.example/x'] },
        SITE,
        entitlement('pro'),
        PUBLIC,
      ),
    ).toEqual({ ok: true, patch: { competitor_hosts: ['a.example'] } });
    expect(
      await decideEdit({ competitorHosts: ['Shop.example'] }, SITE, entitlement('pro'), PUBLIC),
    ).toEqual({ ok: false, status: 400, code: 'invalid_host', field: 'competitorHosts' });
    expect(
      await decideEdit({ competitorHosts: ['not a host'] }, SITE, entitlement('pro'), PUBLIC),
    ).toEqual({ ok: false, status: 400, code: 'invalid_host', field: 'competitorHosts' });
    expect(
      await decideEdit(
        { competitorHosts: ['a.example'] },
        SITE,
        entitlement('pro'),
        engineWith(['10.1.2.3']),
      ),
    ).toEqual({ ok: false, status: 422, code: 'host_refused', field: 'competitorHosts' });
  });

  it('a staging URL needs staging in the plan, is admitted by the engine, and can be cleared', async () => {
    const staging = { stagingUrl: 'https://Staging.shop.example/' };
    expect(await decideEdit(staging, SITE, entitlement('free'), PUBLIC)).toEqual({
      ok: false,
      status: 402,
      code: 'upgrade_required',
      gate: 'stagingAndDeployHooks',
    });
    expect(await decideEdit(staging, SITE, entitlement('pro'), PUBLIC)).toEqual({
      ok: true,
      patch: { staging_host: 'staging.shop.example' },
    });
    expect(
      await decideEdit(staging, SITE, entitlement('pro'), engineWith(['192.168.0.9'])),
    ).toEqual({ ok: false, status: 422, code: 'host_refused', field: 'stagingUrl' });
    expect(
      await decideEdit({ stagingUrl: 'shop.example' }, SITE, entitlement('pro'), PUBLIC),
    ).toEqual({ ok: false, status: 400, code: 'invalid_host', field: 'stagingUrl' });
    expect(await decideEdit({ stagingUrl: null }, SITE, entitlement('free'), PUBLIC)).toEqual({
      ok: true,
      patch: { staging_host: null },
    });
  });

  it('a staging site takes no competitors or staging site of its own', async () => {
    const staging = { host: 'staging.shop.example', isStaging: true };
    for (const body of [{ competitorHosts: ['a.example'] }, { stagingUrl: 'x.example' }]) {
      expect(await decideEdit(body, staging, entitlement('agency'), PUBLIC)).toEqual({
        ok: false,
        status: 409,
        code: 'staging_site',
      });
    }
  });

  it('looks nothing up for a body the tier refuses', async () => {
    const validate = vi.fn(PUBLIC);
    await decideEdit({ competitorHosts: ['a.example'] }, SITE, entitlement('free'), validate);
    await decideEdit({ stagingUrl: 'x.example' }, SITE, entitlement('free'), validate);
    expect(validate).not.toHaveBeenCalled();
  });
});
