/**
 * The Seats and invitation previews (CC-31): who reads each, and the records it reads. The fixtures
 * are the contract's and are not edited; where one holds no seat for a state, the stand-in seat is
 * defined here, in the open.
 */
import type { Seat } from '@crawlmouse/types/v2';
import { fixture } from '../../../../lib/v2/fixtures';
import type { AccountDataset, Viewer } from '../../../../lib/v2/view/account';
import {
  inviteView,
  seatsView,
  type InviteView,
  type SeatsView,
} from '../../../../lib/v2/view/seats';
import { NOTICE_LINES } from '../../../../lib/v2/copy/notices';
import {
  ACCOUNT_VIEWERS,
  BAD_ACCOUNT_ID,
  CLEAN_VIEWER,
  DATASET,
  STAND_IN_FREE_ACCOUNT,
} from './accounts';

/** Lee, Northwind's developer (challenged-site): a member who is not the owner. */
const NORTHWIND_DEVELOPER_SEAT = 'e0000000-0000-4000-8000-0000000000cc';

const bad = fixture('bad-site');
const clean = fixture('clean-site');

/**
 * A stand-in invitation on bad-site's Pro account, which holds its owner's seat alone: with it the
 * plan's two seats are taken. Not a fixture record.
 */
const STAND_IN_INVITATION: Seat = {
  id: 'e0000000-0000-4000-8000-0000000000f2',
  account_id: BAD_ACCOUNT_ID,
  email: 'dev@company.com',
  name: null,
  role: 'developer',
  client_scope: 'all',
  alert_channels: ['email'],
  theme: 'system',
  invited_at: '2026-10-29T14:00:00Z',
  accepted_at: null,
};

/** The owner's seat of the stand-in Free account (clean-site holds no seat). Not a fixture record. */
const STAND_IN_FREE_OWNER: Seat = {
  id: 'e0000000-0000-4000-8000-0000000000f1',
  account_id: STAND_IN_FREE_ACCOUNT.id,
  email: STAND_IN_FREE_ACCOUNT.email,
  name: null,
  role: 'owner',
  client_scope: 'all',
  alert_channels: ['email'],
  theme: 'system',
  invited_at: clean.sites[0]!.created_at,
  accepted_at: clean.sites[0]!.created_at,
};

export const SEATS_PREVIEWS = {
  /** Final-Ag-Seats: Northwind's Agency account, read by its owner. */
  '/v2-preview/screens/seats': {
    data: (): AccountDataset => fixture(DATASET.withheld),
    viewer: ACCOUNT_VIEWERS.withheld,
  },
  /** A Pro account whose two seats are taken: the gate message, and no invite form. */
  '/v2-preview/screens/seats/pro-full': {
    data: (): AccountDataset => ({ ...bad, seats: [...bad.seats, STAND_IN_INVITATION] }),
    viewer: ACCOUNT_VIEWERS.home,
  },
  /** A Free account: the gate message. */
  '/v2-preview/screens/seats/free': {
    data: (): AccountDataset => ({ ...clean, seats: [STAND_IN_FREE_OWNER] }),
    viewer: (): Viewer => CLEAN_VIEWER,
  },
  /** A member who is not the owner: the people and the role table, and no form. */
  '/v2-preview/screens/seats/member': {
    data: (): AccountDataset => fixture(DATASET.withheld),
    viewer: (): Viewer => ({ ...ACCOUNT_VIEWERS.withheld(), seatId: NORTHWIND_DEVELOPER_SEAT }),
  },
} as const;

export type SeatsPreview = keyof typeof SEATS_PREVIEWS;

export function seatsPreview(path: SeatsPreview): SeatsView {
  const p = SEATS_PREVIEWS[path];
  return seatsView(p.data(), p.viewer());
}

const INVITATION = {
  accountName: 'Northwind Digital',
  role: 'developer',
  everyClient: false,
} as const;

export const INVITE_PREVIEWS = {
  /** Signed out: what the invitation is, and the link to sign in. */
  '/v2-preview/screens/invite': (): InviteView => inviteView(INVITATION, false),
  '/v2-preview/screens/invite/signed-in': (): InviteView => inviteView(INVITATION, true),
  /** Sent back by the accept route: the sign-in's address is not the invited one. */
  '/v2-preview/screens/invite/mismatch': (): InviteView =>
    inviteView(INVITATION, true, NOTICE_LINES.email_mismatch(null)),
  /** A link that cannot be used. */
  '/v2-preview/screens/invite/gone': (): InviteView => inviteView(null, true),
} as const;

export type InvitePreview = keyof typeof INVITE_PREVIEWS;
