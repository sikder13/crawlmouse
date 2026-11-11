/**
 * What the site routes accept (CC-26b D6). A host is canonicalised by `hostFromSiteInput` and then
 * admitted by the engine's SSRF guard (`admitSiteHost`: scheme, credentials, DNS, private ranges),
 * the same two steps a named first site takes at sign-up. An edit is a strict body; what it may set
 * is decided with the gates and limits of the site's own account, read by the route
 * (`readEntitlement`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { admitSiteHost } from '../../auth/admit-site';
import { hostFromSiteInput } from '../../auth/site-host';
import type { TierGates } from '../../entitlement-v2';
import type { Entitlement } from './viewer-read';
import type { SitePatch } from './sites-store';

/** The engine's URL check, as `admitSiteHost` takes it; the routes use its default. */
type Validate = Parameters<typeof admitSiteHost>[1];

export type Admitted =
  | { ok: true; host: string }
  | { ok: false; error: 'invalid_host' | 'host_refused' };

/** A typed site as the host the engine admits: the shape first, so a malformed one is never looked up. */
export async function admittedHost(raw: unknown, validate?: Validate): Promise<Admitted> {
  const host = typeof raw === 'string' ? hostFromSiteInput(raw) : null;
  if (host === null) return { ok: false, error: 'invalid_host' };
  return (await admitSiteHost(host, validate))
    ? { ok: true, host }
    : { ok: false, error: 'host_refused' };
}

/** What a person may type for one URL. */
const Typed = z.string().max(2048);

const AddBody = z.strictObject({ url: Typed });

/** POST /api/sites: `{url}` and nothing else. */
export function parseAddBody(fields: unknown): z.infer<typeof AddBody> | null {
  const r = AddBody.safeParse(fields);
  return r.success ? r.data : null;
}

/** A form posts every field as a string; JSON sends the value itself. */
const formInt = (v: unknown) => (typeof v === 'string' && /^\d{1,2}$/.test(v) ? Number(v) : v);
const formList = (v: unknown) =>
  typeof v === 'string' ? v.split(/[\s,]+/).filter((s) => s !== '') : v;
const formNull = (v: unknown) => (v === '' ? null : v);

/**
 * PATCH /api/sites/[id] (ARCH-2 §5's site page row): `schedule` with its weekday (`dow`, ISO, 1 is
 * Monday) and local hour, `competitorHosts`, and `stagingUrl` (null or empty for none). Each is
 * optional, one at least; a timed schedule carries both `dow` and `hour`, `none` carries neither.
 */
const EditBody = z
  .strictObject({
    schedule: z.enum(['weekly', 'monthly', 'none']).optional(),
    dow: z.preprocess(formInt, z.int().min(1).max(7)).optional(),
    hour: z.preprocess(formInt, z.int().min(0).max(23)).optional(),
    competitorHosts: z.preprocess(formList, z.array(Typed).max(10)).optional(),
    stagingUrl: z.preprocess(formNull, Typed.nullable()).optional(),
  })
  .refine((b) => Object.keys(b).length > 0)
  .refine((b) => {
    const timed = b.schedule === 'weekly' || b.schedule === 'monthly';
    return timed === (b.dow !== undefined) && timed === (b.hour !== undefined);
  });

export type EditBody = z.infer<typeof EditBody>;

export function parseEditBody(fields: unknown): EditBody | null {
  const r = EditBody.safeParse(fields);
  return r.success ? r.data : null;
}

export type EditDecision =
  | { ok: true; patch: SitePatch }
  | { ok: false; status: 402; error: 'upgrade_required'; gate: keyof TierGates }
  | {
      ok: false;
      status: 400 | 422;
      error: 'invalid_host' | 'host_refused';
      field: 'competitorHosts' | 'stagingUrl';
    }
  | { ok: false; status: 409; error: 'staging_site' };

const upgrade = (gate: keyof TierGates): EditDecision => ({
  ok: false,
  status: 402,
  error: 'upgrade_required',
  gate,
});

const badHost = (
  error: 'invalid_host' | 'host_refused',
  field: 'competitorHosts' | 'stagingUrl',
): EditDecision => ({ ok: false, status: error === 'invalid_host' ? 400 : 422, error, field });

/**
 * The patch an edit body makes, or the refusal. The tier's rules come before any DNS lookup, so a
 * body the tier refuses is never looked up: a weekly schedule needs `schedule: 'weekly'`; any
 * competitor needs `competitorsPerSite` above zero, and their number fits the account's limit; a
 * staging URL needs `stagingAndDeployHooks`. A staging site takes neither competitors nor a staging
 * site of its own. Clearing either, and a monthly schedule or none, is open to every tier.
 */
export async function decideEdit(
  body: EditBody,
  site: { host: string; isStaging: boolean },
  entitlement: Pick<Entitlement, 'gates' | 'limits'>,
  validate?: Validate,
): Promise<EditDecision> {
  const { gates, limits } = entitlement;
  if (site.isStaging && (body.competitorHosts !== undefined || body.stagingUrl !== undefined)) {
    return { ok: false, status: 409, error: 'staging_site' };
  }
  const patch: SitePatch = {};

  if (body.schedule !== undefined) {
    if (body.schedule === 'weekly' && gates.schedule !== 'weekly') return upgrade('schedule');
    patch.schedule =
      body.schedule === 'none'
        ? null
        : { cadence: body.schedule, iso_weekday: body.dow!, hour_local: body.hour! };
  }

  if (body.competitorHosts !== undefined) {
    const hosts: string[] = [];
    for (const raw of body.competitorHosts) {
      const host = hostFromSiteInput(raw);
      if (host === null || host === site.host) return badHost('invalid_host', 'competitorHosts');
      if (!hosts.includes(host)) hosts.push(host);
    }
    if (hosts.length > limits.competitorsPerSite) return upgrade('competitorsPerSite');
    for (const host of hosts) {
      const admitted = await admittedHost(host, validate);
      if (!admitted.ok) return badHost(admitted.error, 'competitorHosts');
    }
    patch.competitor_hosts = hosts;
  }

  if (body.stagingUrl !== undefined) {
    if (body.stagingUrl === null) {
      patch.staging_host = null;
    } else {
      if (!gates.stagingAndDeployHooks) return upgrade('stagingAndDeployHooks');
      const host = hostFromSiteInput(body.stagingUrl);
      if (host === null || host === site.host) return badHost('invalid_host', 'stagingUrl');
      const admitted = await admittedHost(host, validate);
      if (!admitted.ok) return badHost(admitted.error, 'stagingUrl');
      patch.staging_host = host;
    }
  }
  return { ok: true, patch };
}

/** What a site route reads of the site through the caller's session (`sites_member_read`). */
const SiteRow = z.object({
  id: z.string(),
  account_id: z.string(),
  host: z.string(),
  staging_of_site_id: z.string().nullable(),
  removed_at: z.string().nullable(),
  paused_reason: z.string().nullable(),
});

export type SiteRow = z.infer<typeof SiteRow>;

/**
 * The site as the caller may read it, or null: row security (`is_member_for_site`) returns no row
 * for a site outside the caller's seats, and none for a site no account keeps.
 */
export async function readSite(session: SupabaseClient, siteId: string): Promise<SiteRow | null> {
  const { data, error } = await session
    .from('sites')
    .select('id, account_id, host, staging_of_site_id, removed_at, paused_reason')
    .eq('id', siteId)
    .maybeSingle();
  if (error) throw new Error(`sites read failed: ${error.message}`);
  return data === null ? null : SiteRow.parse(data);
}

/** A 429 for a request over a per-day bound, with when the next one is allowed. */
export function tooSoon(error: string, nextAllowedAt: string, now = Date.now()): Response {
  const seconds = Math.max(1, Math.ceil((Date.parse(nextAllowedAt) - now) / 1000));
  return Response.json(
    { error, nextAllowedAt },
    { status: 429, headers: { 'retry-after': String(seconds) } },
  );
}
