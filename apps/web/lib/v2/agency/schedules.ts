/**
 * Client report schedules (CC-31 D8; docs/specs/v2/31-agency.md §10): the routes' bodies and
 * answers, the two links a recipient is sent, and the port the mails are asked for through.
 *
 * A client's report goes to the client's contact, one address a site. The contact confirms before
 * any report is sent (a link in a confirmation mail), and can pause the schedule from any report
 * (a link, and a mail client's one-click unsubscribe). The rules are SQL's (migration
 * 20261114000002, section B); this file reads a body, asks the store, and answers. A form is
 * answered with a 303 back to its page and a notice, JSON with JSON.
 */
import { TimeZoneSchema } from '@crawlmouse/types/v2';
import { z } from 'zod';
import { clearLinkCookie, linkToken, type LinkFlow } from '../account/link-cookie';
import {
  noticeTo,
  notFound,
  refuse,
  refuseTo,
  type NoticeCode,
  type RequestBody,
} from '../account/route';
import { readBounded } from '../mail/unsubscribe';
import type { ConfirmationState, SchedulesStore } from './schedules-store';

/** The page the schedule forms are on. */
export const CLIENT_REPORTS_PAGE = '/agency/reports';

export const CADENCES = ['weekly', 'monthly'] as const;
export type Cadence = (typeof CADENCES)[number];

// ─── bodies ──────────────────────────────────────────────────────────────────────────────────────

const ScheduleBody = z.strictObject({
  cadence: z.enum(CADENCES),
  isoWeekday: z.int().min(1).max(7),
  timeLocal: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
  // The contract's own rule for a zone (`TimeZoneSchema`): an IANA name the runtime knows. The
  // account's records are parsed with it when they are read, so a name it refuses, stored here,
  // would make each page of the account throw; and an offset such as `+05:00`, which `Intl` reads
  // east of UTC and Postgres west, is not a name it takes.
  timezone: TimeZoneSchema,
  sendWhenUnchanged: z.boolean(),
});

export type ScheduleInput = z.infer<typeof ScheduleBody>;

/**
 * A form's schedule as JSON sends it: the weekday as a number, and the "send when nothing changed"
 * box as a boolean (a form posts `on` for a ticked box and nothing for one left empty).
 */
function scheduleAsJson(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { isoWeekday, sendWhenUnchanged, ...rest } = fields;
  return {
    ...rest,
    isoWeekday:
      typeof isoWeekday === 'string' && /^[1-7]$/.test(isoWeekday)
        ? Number(isoWeekday)
        : isoWeekday,
    sendWhenUnchanged:
      sendWhenUnchanged === undefined ? false : sendWhenUnchanged === 'on' || sendWhenUnchanged,
  };
}

/** PUT …/schedules/site/[siteId]: `{cadence, isoWeekday, timeLocal, timezone, sendWhenUnchanged}`. */
export function parseScheduleBody(body: RequestBody): ScheduleInput | null {
  const r = ScheduleBody.safeParse(
    body.kind === 'form' ? scheduleAsJson(body.fields) : body.fields,
  );
  return r.success ? r.data : null;
}

const ClientBody = z
  .strictObject({
    clientName: z.string().trim().max(200).nullable(),
    contactEmail: z.string().trim().toLowerCase().max(254).pipe(z.email()).nullable(),
    ownerSeatId: z.uuid().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0);

export type ClientInput = z.infer<typeof ClientBody>;

/** A form's empty field is "none": JSON's null. */
const emptyAsNull = (fields: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === '' ? null : v]));

/** PATCH …/client: any of `{clientName, contactEmail, ownerSeatId}`, null to clear one. */
export function parseClientBody(body: RequestBody): ClientInput | null {
  const r = ClientBody.safeParse(body.kind === 'form' ? emptyAsNull(body.fields) : body.fields);
  return r.success ? r.data : null;
}

// ─── the mails ───────────────────────────────────────────────────────────────────────────────────

/**
 * What asks for the two mails of a client report. Neither request holds an address or a token: the
 * handler reads both from SQL when it sends (`issue_recipient_confirmation`, `issue_report_pause`).
 */
export interface ClientReportMail {
  /** The confirmation mail of a site's schedule. `key` makes one request of repeats of the same ask. */
  confirmation(req: { siteId: string; key: string }): Promise<void>;
  /** A client report's mail: `sent` once it has gone, `queued` when it was handed on to be sent. */
  report(req: { reportId: string }): Promise<'sent' | 'queued'>;
}

export interface ConfirmationRequestedEvent {
  id: string;
  name: 'report.confirmation.requested';
  data: { site_id: string; request_id: string };
}

export interface ReportSendRequestedEvent {
  id: string;
  name: 'report.send.requested';
  data: { report_id: string };
}

export const confirmationRequestedEvent = (
  siteId: string,
  key: string,
): ConfirmationRequestedEvent => ({
  id: `report_confirm:${siteId}:${key}`,
  name: 'report.confirmation.requested',
  // The mail's ledger key holds request_id, so a repeat of one ask sends one mail (lib/v2/mail/handlers.ts).
  data: { site_id: siteId, request_id: key },
});

/** The event's id is the report's, so a report asked for twice is one event to Inngest. */
export const reportSendRequestedEvent = (reportId: string): ReportSendRequestedEvent => ({
  id: `client_report:${reportId}`,
  name: 'report.send.requested',
  data: { report_id: reportId },
});

// ─── the account's routes ────────────────────────────────────────────────────────────────────────

/** The site a route established the caller's reach of, and its account. */
export interface ClientSite {
  siteId: string;
  accountId: string;
}

type Kind = RequestBody['kind'];

const done = (kind: Kind, notice: NoticeCode, json: Record<string, unknown>) =>
  kind === 'form' ? noticeTo(CLIENT_REPORTS_PAGE, notice) : Response.json(json);

/** PUT …/schedules/site/[siteId]: 400 `invalid` for a body or a zone that is not a schedule's. */
export async function saveSchedule(
  deps: ClientDeps,
  site: ClientSite,
  body: RequestBody | null,
): Promise<Response> {
  const kind = body?.kind ?? 'json';
  const input = body && parseScheduleBody(body);
  if (!input) return refuseTo(kind, CLIENT_REPORTS_PAGE, 400, 'invalid');
  const r = await deps.store.setSchedule(site, input, deps.now());
  switch (r.outcome) {
    case 'saved': {
      // A contact saved before its schedule has not been asked yet: it is asked now, and not
      // again by the first run.
      const confirmation = await askToConfirm(deps, site, ['pending']);
      return done(kind, SAVED_SCHEDULE[confirmation], { nextRunAt: r.nextRunAt, confirmation });
    }
    case 'invalid':
      return refuseTo(kind, CLIENT_REPORTS_PAGE, 400, 'invalid');
    case 'not_found':
      return notFound();
  }
}

/** DELETE …/schedules/site/[siteId]. */
export async function clearSchedule(
  deps: { store: SchedulesStore },
  site: ClientSite,
  kind: Kind,
): Promise<Response> {
  const r = await deps.store.clearSchedule(site);
  return r.outcome === 'cleared' ? done(kind, 'schedule_cleared', { cleared: true }) : notFound();
}

export interface LimitVerdict {
  allowed: boolean;
  resetAt: Date;
}

export interface ClientDeps {
  store: SchedulesStore;
  mail: ClientReportMail;
  /** The account's daily bound on confirmation mail it asks for. */
  confirmations(): Promise<LimitVerdict>;
  now(): Date;
}

/**
 * What became of asking a site's contact to confirm: `asked` (the mail was asked for); `waits`
 * (the account is in its Agency trial and the contact is not its owner's own address: nothing is
 * mailed until the trial has become the plan); `later` (the account's daily bound is spent: the
 * schedule's next run asks); `none` (nothing to ask: no schedule, no contact, a schedule its
 * recipient has paused, a contact that has confirmed, or one the caller's `when` does not ask again).
 *
 * `declined` (the contact answered "Don't ask me again": nothing asks that address for this site
 * again); `recent` (the contact paused the reports and was asked to confirm again since: it may be
 * asked again once the window has passed).
 *
 * `asked` says the request was made, not that a mail was delivered: the mailer keeps a bound of its
 * own for each address, across accounts, and answers a request past it by sending nothing.
 */
export type Confirmation = 'asked' | 'waits' | 'later' | 'none' | 'declined' | 'recent';

/**
 * The outcome; with `later` the verdict that refused it (it holds when the bound resets), and with
 * `recent` when the contact may be asked again.
 */
type Asked =
  | { confirmation: Exclude<Confirmation, 'later' | 'recent'> }
  | { confirmation: 'later'; verdict: LimitVerdict }
  | { confirmation: 'recent'; nextAt: string };

async function ask(
  deps: ClientDeps,
  site: ClientSite,
  when: readonly ConfirmationState[],
): Promise<Asked> {
  const state = await deps.store.confirmationState(site);
  if (state === 'trial') return { confirmation: 'waits' };
  if (state === 'no_schedule' || state === 'no_contact') return { confirmation: 'none' };
  // What the recipient refused comes before anything the account asks (`report_ask_refusals`).
  const refusal = await deps.store.askRefusal(site, deps.now());
  if (refusal?.refused === 'declined') return { confirmation: 'declined' };
  if (refusal?.refused === 'asked_recently')
    return { confirmation: 'recent', nextAt: refusal.nextAt };
  if (!when.includes(state)) return { confirmation: 'none' };
  const verdict = await deps.confirmations();
  if (!verdict.allowed) return { confirmation: 'later', verdict };
  await deps.mail.confirmation({ siteId: site.siteId, key: deps.now().toISOString() });
  return { confirmation: 'asked' };
}

const askToConfirm = async (
  deps: ClientDeps,
  site: ClientSite,
  when: readonly ConfirmationState[],
): Promise<Confirmation> => (await ask(deps, site, when)).confirmation;

const SAVED_SCHEDULE: Record<Confirmation, NoticeCode> = {
  asked: 'schedule_saved_asked',
  waits: 'schedule_saved_waits',
  later: 'schedule_saved',
  none: 'schedule_saved',
  declined: 'schedule_saved_not_asked',
  recent: 'schedule_saved_not_asked',
};
const RESUMED: Record<Confirmation, NoticeCode> = {
  asked: 'schedule_resumed',
  waits: 'confirmation_waits',
  later: 'schedule_resumed_later',
  none: 'schedule_resumed_later',
  // The resume itself refuses these two before it lifts anything; they are here for a refusal
  // recorded between the resume and the ask.
  declined: 'contact_declined',
  recent: 'asked_recently',
};
const SAVED_CLIENT: Record<Confirmation, NoticeCode> = {
  asked: 'client_saved_asked',
  waits: 'client_saved_waits',
  later: 'client_saved_later',
  none: 'client_saved',
  declined: 'client_saved_not_asked',
  recent: 'client_saved_not_asked',
};

/**
 * PATCH …/client: the client's name, contact address and owning seat. A contact that changed, on a
 * client that has a schedule, is asked to confirm at once, within the account's daily bound; past
 * the bound the save stands and the schedule's next run asks; with no schedule yet, saving the
 * schedule asks. The answer says which (`confirmation`). 400 `invalid_owner` for a seat that is not
 * an active seat of the account covering the site.
 */
export async function saveClient(
  deps: ClientDeps,
  site: ClientSite,
  body: RequestBody | null,
): Promise<Response> {
  const kind = body?.kind ?? 'json';
  const input = body && parseClientBody(body);
  if (!input) return refuseTo(kind, CLIENT_REPORTS_PAGE, 400, 'invalid');
  const r = await deps.store.setClient(site, input);
  switch (r.outcome) {
    case 'saved': {
      const confirmation =
        r.contactChanged && input.contactEmail
          ? await askToConfirm(deps, site, ['pending'])
          : 'none';
      return done(kind, SAVED_CLIENT[confirmation], {
        contactChanged: r.contactChanged,
        confirmation,
      });
    }
    case 'invalid_owner':
      return refuseTo(kind, CLIENT_REPORTS_PAGE, 400, 'invalid_owner');
    case 'not_found':
      return notFound();
  }
}

/**
 * POST …/confirm: the confirmation mail again, for a schedule whose contact has not confirmed.
 * 409 `nothing_to_confirm` with no schedule, no contact, a contact that has confirmed or a schedule
 * its recipient has paused (the account's ask of a paused schedule is its resume); 409
 * `confirmation_waits` in an Agency trial for a contact that is not the owner's own address; 429
 * past the account's daily bound.
 */
export async function resendConfirmation(
  deps: ClientDeps,
  site: ClientSite,
  kind: Kind,
): Promise<Response> {
  const asked = await ask(deps, site, ['pending', 'asked']);
  switch (asked.confirmation) {
    case 'asked':
      return done(kind, 'confirmation_requested', { requested: true });
    case 'waits':
      return refuseTo(kind, CLIENT_REPORTS_PAGE, 409, 'confirmation_waits');
    case 'none':
      return refuseTo(kind, CLIENT_REPORTS_PAGE, 409, 'nothing_to_confirm');
    case 'declined':
      return refuseTo(kind, CLIENT_REPORTS_PAGE, 409, 'contact_declined');
    case 'recent':
      return refuseTo(kind, CLIENT_REPORTS_PAGE, 409, 'asked_recently', {
        nextAllowedAt: asked.nextAt,
      });
    case 'later': {
      const { verdict } = asked;
      const seconds = Math.max(
        1,
        Math.ceil((verdict.resetAt.getTime() - deps.now().getTime()) / 1000),
      );
      return kind === 'form'
        ? noticeTo(CLIENT_REPORTS_PAGE, 'rate_limited', verdict.resetAt.toISOString())
        : refuse(429, 'rate_limited', {}, { 'retry-after': String(seconds) });
    }
  }
}

/**
 * POST …/resume, for a schedule its recipient paused. A recipient's pause is final from the
 * sender's side (owner ruling): this restarts no mail. The pause is lifted and the contact is
 * asked to confirm again, under the bounds of any confirmation; reports start again only when the
 * recipient confirms. The answer says what became of the request (`confirmation`).
 * It may ask once: 409 `contact_declined` where the recipient answered "Don't ask me again", and
 * 409 `asked_recently`, with when it may ask again, where they were asked since their pause.
 */
export async function resumeSchedule(
  deps: ClientDeps,
  site: ClientSite,
  kind: Kind,
): Promise<Response> {
  const r = await deps.store.resume(site, deps.now());
  switch (r.outcome) {
    case 'resumed': {
      const confirmation = await askToConfirm(deps, site, ['pending']);
      return done(kind, RESUMED[confirmation], { nextRunAt: r.nextRunAt, confirmation });
    }
    case 'declined':
      return refuseTo(kind, CLIENT_REPORTS_PAGE, 409, 'contact_declined');
    case 'asked_recently':
      return refuseTo(kind, CLIENT_REPORTS_PAGE, 409, 'asked_recently', {
        nextAllowedAt: r.nextAt,
      });
    case 'not_paused':
      return refuseTo(kind, CLIENT_REPORTS_PAGE, 409, 'not_paused');
    case 'not_found':
      return notFound();
  }
}

// ─── the recipient's links ───────────────────────────────────────────────────────────────────────

/**
 * The links a recipient is sent, by their flow in `LINK_FLOWS`. "Don't ask me again" is in the
 * mail that asks to confirm, with that link's own token, and on the pause page.
 */
export const RECIPIENT_LINKS = {
  confirm: { flow: 'reportConfirm', done: 'report_confirmed' },
  pause: { flow: 'reportPause', done: 'report_paused' },
  decline: { flow: 'reportDecline', done: 'report_declined' },
} as const satisfies Record<string, { flow: LinkFlow; done: NoticeCode }>;

export type RecipientLink = keyof typeof RECIPIENT_LINKS;

const PAGES = { confirm: '/s/confirm', pause: '/s/pause', decline: '/s/decline' } as const;

const USE = {
  confirm: (store: SchedulesStore, token: string, now: Date) => store.confirm(token, now),
  pause: (store: SchedulesStore, token: string, now: Date) => store.pause(token, now),
  decline: (store: SchedulesStore, token: string, now: Date) => store.decline(token, now),
} as const;

/** The recipient's form posts no field: the token is the cookie's. */
const NoFields = z.strictObject({});

/**
 * POST /api/report-files/confirm, /pause and /decline, from the page a link landed on. The
 * token is read from the link's cookie and from nowhere else. Done: the cookie is cleared and a form
 * goes back to its page with the line saying so. 410 `report_link_gone` for no token and for a link
 * that cannot be used.
 */
export async function useRecipientLink(
  deps: { store: SchedulesStore; now(): Date },
  link: RecipientLink,
  token: string | null,
  body: RequestBody | null,
): Promise<Response> {
  if (!body || !NoFields.safeParse(body.fields).success) return refuse(400, 'invalid');
  const { flow, done: notice } = RECIPIENT_LINKS[link];
  const gone = () =>
    body.kind === 'form'
      ? noticeTo(PAGES[link], 'report_link_gone')
      : refuse(410, 'report_link_gone');
  if (token === null) return gone();
  const outcome = await USE[link](deps.store, token, deps.now());
  if (outcome === 'gone') {
    const res = gone();
    res.headers.append('Set-Cookie', clearLinkCookie(flow));
    return res;
  }
  const res =
    body.kind === 'form' ? noticeTo(PAGES[link], notice) : Response.json({ [outcome]: true });
  res.headers.append('Set-Cookie', clearLinkCookie(flow));
  return res;
}

/** The page a "Don't ask me again" form was on, by the link whose cookie holds its token. */
const DECLINE_FROM = { confirm: 'reportConfirm', pause: 'reportPause' } as const;
const DeclineFields = z.strictObject({ from: z.enum(['confirm', 'pause']).optional() });

/**
 * POST /api/report-files/decline: "Don't ask me again", from its own page (the link in the mail
 * that asks to confirm) or from the confirmation page or the pause page, whose form names itself
 * in `from`. The token is read from that page's cookie and from nowhere else; `cookieHeader` is the
 * request's. Done: that cookie is cleared and a form goes to `/s/decline` with the line saying so.
 * 410 `report_link_gone` for no token and for a link no schedule holds.
 */
export async function declineFromPage(
  deps: { store: SchedulesStore; now(): Date },
  cookieHeader: string | null,
  body: RequestBody | null,
): Promise<Response> {
  const fields = body && DeclineFields.safeParse(body.fields);
  if (!body || !fields?.success) return refuse(400, 'invalid');
  const flow: LinkFlow = fields.data.from ? DECLINE_FROM[fields.data.from] : 'reportDecline';
  const token = linkToken(cookieHeader, flow);
  const gone = () =>
    body.kind === 'form'
      ? noticeTo(PAGES.decline, 'report_link_gone')
      : refuse(410, 'report_link_gone');
  if (token === null) return gone();
  const outcome = await deps.store.decline(token, deps.now());
  const res =
    outcome === 'gone'
      ? gone()
      : body.kind === 'form'
        ? noticeTo(PAGES.decline, RECIPIENT_LINKS.decline.done)
        : Response.json({ declined: true });
  res.headers.append('Set-Cookie', clearLinkCookie(flow));
  return res;
}

/**
 * The fields of a one-click POST, which a mail client sends form-encoded or as multipart form data
 * (RFC 8058 allows both), read up to the mailer's bound. Null for another media type, a body past
 * the bound, and one that does not parse or holds a file.
 */
export async function oneClickFields(req: Request): Promise<Record<string, string> | null> {
  const type = req.headers.get('content-type') ?? '';
  if (!/^(?:application\/x-www-form-urlencoded|multipart\/form-data)\b/i.test(type)) return null;
  const text = await readBounded(req);
  if (text === null) return null;
  try {
    const form = await new Response(text, { headers: { 'content-type': type } }).formData();
    const fields: Record<string, string> = {};
    for (const [name, value] of form.entries()) {
      if (typeof value !== 'string' || name in fields) return null;
      fields[name] = value;
    }
    return fields;
  } catch {
    return null;
  }
}

/**
 * POST /s/pause/[token]: a mail client's one-click unsubscribe (RFC 8058). It posts
 * `List-Unsubscribe=One-Click` to the address in the mail's List-Unsubscribe header, with no cookie,
 * so for this one request the token is the path's. Any other body is 400, and a GET of that address
 * changes nothing (it is the link's landing). 200 with no body once paused; 404 for a token no
 * schedule holds.
 */
export const oneClickPause = (
  deps: { store: SchedulesStore; now(): Date },
  token: string,
  fields: Readonly<Record<string, string>> | null,
): Promise<Response> => oneClick(deps, 'pause', token, fields);

/**
 * POST /s/decline/[token]: the one-click unsubscribe of the mail that asks to confirm. Its token
 * is the confirmation link's, and what it records is "Don't ask me again". The same answers.
 */
export const oneClickDecline = (
  deps: { store: SchedulesStore; now(): Date },
  token: string,
  fields: Readonly<Record<string, string>> | null,
): Promise<Response> => oneClick(deps, 'decline', token, fields);

async function oneClick(
  deps: { store: SchedulesStore; now(): Date },
  link: 'pause' | 'decline',
  token: string,
  fields: Readonly<Record<string, string>> | null,
): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  if (
    fields === null ||
    Object.keys(fields).length !== 1 ||
    fields['List-Unsubscribe'] !== 'One-Click'
  ) {
    return refuse(400, 'invalid', {}, headers);
  }
  const outcome = await USE[link](deps.store, token, deps.now());
  return outcome === 'gone'
    ? refuse(404, 'not_found', {}, headers)
    : new Response(null, { status: 200, headers });
}
