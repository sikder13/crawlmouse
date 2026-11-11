/**
 * What the email change's two pages show (`/account/email`, `/account/email-undo`): the answer the
 * form's POST sent back in the query, or else the state of the link whose token is in the flow's
 * cookie. A live link shows the address the button moves to, masked (`lib/auth/mask-email.ts`); the
 * token itself is never part of the view.
 */
import { maskEmail } from '../../auth/mask-email';
import type { LinkFlow } from './link-cookie';
import { hashToken } from './tokens';

/**
 * The confirmation link's life, and the undo link's from the confirm (section A: 60 minutes, 7 days;
 * before the confirm the undo link lasts both together).
 */
export const EMAIL_CHANGE_LINK_MINUTES = 60;
export const EMAIL_UNDO_DAYS = 7;

export type EmailLinkFlow = Extract<LinkFlow, 'emailChange' | 'emailUndo'>;

const KIND: Readonly<Record<EmailLinkFlow, string>> = {
  emailChange: 'email_change',
  emailUndo: 'email_change_undo',
};

/** The refusals a page names; any other code it reads as `other`. */
export const PAGE_CODES = [
  'address_taken',
  'auth_failed',
  'link_unusable',
  'account_deleting',
] as const;
export type PageCode = (typeof PAGE_CODES)[number] | 'other';

export interface LinkRow {
  new_email: string;
  old_email: string;
  used_at: string | null;
  revoked_at: string | null;
  expires_at: string;
}

/** Reads the token row of this kind with this hash, or null. */
export type ReadLink = (hash: string, kind: string) => Promise<LinkRow | null>;

export type EmailLinkView =
  | { state: 'ready'; address: string }
  | { state: 'unusable' }
  | { state: 'done' }
  | { state: 'refused'; code: PageCode };

export async function emailLinkPage(
  read: ReadLink,
  flow: EmailLinkFlow,
  token: string | null,
  query: { done?: string; error?: string },
  now: Date,
): Promise<EmailLinkView> {
  if (query.done === '1') return { state: 'done' };
  if (query.error !== undefined) {
    const code = PAGE_CODES.find((c) => c === query.error) ?? 'other';
    return { state: 'refused', code };
  }
  if (token === null) return { state: 'unusable' };
  const row = await read(hashToken(token), KIND[flow]);
  if (
    row === null ||
    row.used_at !== null ||
    row.revoked_at !== null ||
    Date.parse(row.expires_at) <= now.getTime()
  ) {
    return { state: 'unusable' };
  }
  const address = maskEmail(flow === 'emailChange' ? row.new_email : row.old_email);
  return address === null ? { state: 'unusable' } : { state: 'ready', address };
}
