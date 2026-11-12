/**
 * The email change's two pages (CC-27b D3): the confirmation link's (`/account/email`) and the undo
 * link's (`/account/email-undo`). Neither has a locked screen, so nothing here is in the copy
 * registry's comparison. Every duration is a parameter, filled from the constants the database's
 * expiries are pinned to (`lib/v2/account/email-change-page.ts`).
 */
import {
  EMAIL_CHANGE_LINK_MINUTES,
  EMAIL_UNDO_DAYS,
  type PageCode,
} from '../account/email-change-page';

export const SUPPORT_ADDRESS = 'support@crawlmouse.com';

interface FlowCopy {
  title: string;
  ready: { heading: string; lead: (address: string) => string; button: string };
  done: { heading: string; lead: string };
  unusable: { heading: string; lead: string };
  refused: Readonly<Record<PageCode, string>>;
}

const NOTHING_CHANGED = 'Nothing has changed.';

export const EMAIL_CHANGE_COPY = {
  emailChange: {
    title: 'Change your sign-in address',
    ready: {
      heading: 'Change your sign-in address.',
      lead: (address) =>
        `Your sign-in address becomes ${address}. Every other browser signed in to your account is signed out.`,
      button: 'Change my address',
    },
    done: {
      heading: 'Your sign-in address is changed.',
      lead: `Sign in with the new address from now on. Every other browser signed in to your account has been signed out. The link we sent to the old address can put it back for ${EMAIL_UNDO_DAYS} days.`,
    },
    unusable: {
      heading: 'This link has been used or has expired.',
      lead: `Ask for the change again from Settings; the new link works for ${EMAIL_CHANGE_LINK_MINUTES} minutes.`,
    },
    refused: {
      address_taken: `That address belongs to another Crawlmouse account. ${NOTHING_CHANGED}`,
      auth_failed: `We could not change your address just now. ${NOTHING_CHANGED} Ask for the change again from Settings.`,
      link_unusable:
        'This link has been used or has expired. Ask for the change again from Settings.',
      account_deleting: `This account is being deleted, so its address cannot change. ${NOTHING_CHANGED}`,
      other: `Something went wrong. ${NOTHING_CHANGED}`,
    },
  },
  emailUndo: {
    title: 'Stop the change to your sign-in address',
    ready: {
      heading: 'Stop the change to your sign-in address.',
      lead: (address) =>
        `Your sign-in address stays ${address}, or goes back to it if the change has already been confirmed. Every browser signed in to your account is signed out.`,
      button: 'Stop the change',
    },
    done: {
      heading: 'The change is stopped.',
      lead: 'Your sign-in address is the one this email was sent to. Every browser signed in to your account has been signed out; sign in again with this address.',
    },
    unusable: {
      heading: 'This link has been used or has expired.',
      lead: `If your address was changed without you, write to ${SUPPORT_ADDRESS}.`,
    },
    refused: {
      address_taken: `Another Crawlmouse account now holds your old address, so we could not put it back. Write to ${SUPPORT_ADDRESS}.`,
      auth_failed:
        'We could not put your address back just now. Open the link in the email again to try once more.',
      link_unusable: `This link has been used or has expired. If your address was changed without you, write to ${SUPPORT_ADDRESS}.`,
      account_deleting: `This account is being deleted. Write to ${SUPPORT_ADDRESS}.`,
      other: 'Something went wrong. Open the link in the email again to try once more.',
    },
  },
} satisfies Record<'emailChange' | 'emailUndo', FlowCopy>;
