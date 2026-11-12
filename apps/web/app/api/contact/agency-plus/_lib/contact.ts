/**
 * The Agency Plus contact form (CC-29 D2, FACTS A3: a contact form only, nothing built behind it).
 * The route answers 404 while V2_BILLING is off and reads the JSON body; this takes it from there,
 * in order: a strict body; a per-IP daily limit; Turnstile when
 * it is enforced (`turnstileEnforced`: a secret is set, or this is production); then the request is
 * stored with the service role and `email.requested {template: 'agency_plus_contact', contactId}`
 * names the row for the mailer. The address is in the row only, never in the event.
 */
import { z } from 'zod';

/** Contact requests one address may send a day. */
export const CONTACT_PER_IP_PER_DAY = 5;

const Body = z.strictObject({
  email: z.email().max(320),
  sites: z.number().int().min(1).max(100_000),
  note: z.string().trim().max(2000).optional(),
  turnstileToken: z.string().min(1).max(4096).optional(),
});

export interface AgencyPlusEvent {
  /** Inngest's idempotency key: one event per stored request. */
  id: string;
  name: 'email.requested';
  data: { template: 'agency_plus_contact'; contactId: string };
}

export interface ContactDeps {
  /** `getClientIp`'s value; 'unknown' when there is none, which no per-IP bucket counts. */
  ip: string;
  /** Counts one request against `key`'s bucket: CONTACT_PER_IP_PER_DAY a day. */
  rateLimit(key: string): Promise<{ allowed: boolean }>;
  turnstileEnforced: boolean;
  verifyTurnstile(token: string, ip: string | undefined): Promise<boolean>;
  /** Stores the request; returns its id. */
  insert(row: { email: string; sites: number; note: string | null }): Promise<string>;
  send(event: AgencyPlusEvent): Promise<unknown>;
}

export const answer = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status });

export function agencyPlusEvent(contactId: string): AgencyPlusEvent {
  return {
    id: `email.requested:agency_plus_contact:${contactId}`,
    name: 'email.requested',
    data: { template: 'agency_plus_contact', contactId },
  };
}

/** `body` is the request's parsed JSON, or null when it was not JSON. */
export async function contactAgencyPlus(body: unknown, deps: ContactDeps): Promise<Response> {
  const parsed = Body.safeParse(body);
  if (!parsed.success) return answer(400, { error: 'invalid' });
  const { email, sites, note, turnstileToken } = parsed.data;

  if (deps.ip !== 'unknown') {
    const rl = await deps.rateLimit(`contact:ip:${deps.ip}`);
    if (!rl.allowed) return answer(429, { error: 'rate_limited' });
  }
  if (deps.turnstileEnforced) {
    const ok = turnstileToken
      ? await deps.verifyTurnstile(turnstileToken, deps.ip === 'unknown' ? undefined : deps.ip)
      : false;
    if (!ok) return answer(400, { error: 'captcha_failed' });
  }

  const id = await deps.insert({ email, sites, note: note ? note : null });
  await deps.send(agencyPlusEvent(id));
  return answer(200, { ok: true });
}
