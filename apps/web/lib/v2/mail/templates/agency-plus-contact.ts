/**
 * `email.requested {template: 'agency_plus_contact'}` (CC-29, rulings Q38): an Agency Plus request,
 * mailed to our own sales inbox and never to the address the form was given. That address, the site
 * count and the note are someone else's input, so each is data in the body: escaped in the HTML, the
 * address folded to one line, and the note quoted line by line in the text part so no line of it reads
 * as a line of ours. The subject holds the site count, a number, and neither the address nor the
 * note; nothing given is a link.
 *
 * The message carries no Reply-To: the extra headers `buildOutgoing` accepts are `EXTRA_HEADERS`
 * (headers.ts: List-Unsubscribe and List-Unsubscribe-Post), and an address no one verified is not one
 * we let steer a reply. The inbox replies by writing to the address the body shows.
 */
import { SUPPORT_ADDRESS } from '../../copy/email-change';
import { count, plural } from '../../words';
import { bounded, oneLine } from '../escape';
import { layout } from '../layout';
import type { Template } from '../types';
import { para, pre, small } from './parts';

/** Where a request goes: the inbox Pricing's Agency Plus form says the reply comes from. */
export const AGENCY_PLUS_INBOX = SUPPORT_ADDRESS;

export interface AgencyPlusContactInput {
  /** The work email the form was given, unverified. */
  email: string;
  /** How many client sites, as given; null when the row has none. */
  sites: number | null;
  note: string | null;
}

/** Longest address shown: the column's own bound (contact_requests.email). */
export const EMAIL_MAX = 320;
/** Longest note shown: the column's own bound (contact_requests.note), so this cuts only a row edited by hand. */
export const NOTE_MAX = 2000;

const LEAD = 'Someone sent the Agency Plus form on the Pricing page.';
const UNVERIFIED =
  'The work email is what the form was given; nothing has checked that it belongs to the person who sent it.';

/** The note's lines, with Windows and old Mac line ends read as one, bounded, each without trailing space. */
const noteLines = (note: string): string[] =>
  bounded(note.replace(/\r\n?/g, '\n'), NOTE_MAX)
    .split('\n')
    .map((l) => l.trimEnd());

export const agencyPlusContact: Template<AgencyPlusContactInput> = ({ email, sites, note }) => {
  const address = oneLine(email, EMAIL_MAX);
  const siteLine = `Client sites: ${sites === null ? 'not given' : count(sites)}`;
  const subject =
    sites === null
      ? 'Agency Plus request'
      : `Agency Plus request: ${count(sites)} client ${plural(sites, 'site', 'sites')}`;
  const given = note !== null && note.trim() !== '' ? noteLines(note) : null;
  const cut =
    note !== null && [...note.replace(/\r\n?/g, '\n')].length > NOTE_MAX
      ? 'The note was cut at its end here.'
      : null;
  const noteText =
    given === null
      ? ['Note: none']
      : ['Note:', ...given.map((l) => (l === '' ? '>' : `> ${l}`)), ...(cut ? [cut] : [])];

  return {
    subject,
    text: [LEAD, '', `Work email: ${address}`, siteLine, ...noteText, '', UNVERIFIED].join('\n'),
    html: layout({
      title: subject,
      body: [
        para(LEAD),
        para(`Work email: ${address}`),
        para(siteLine),
        ...(given === null ? [para('Note: none')] : [para('Note:'), pre(given.join('\n'))]),
        ...(cut ? [para(cut)] : []),
        small(UNVERIFIED),
      ].join(''),
      why: 'Sent once for each request the Agency Plus form records.',
    }),
  };
};
