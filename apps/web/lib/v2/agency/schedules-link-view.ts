/**
 * The page a client report's recipient lands on from the confirmation link or the pause link, as
 * data (CC-31 D8). It says what the button will do, and offers the one button; after the press it
 * says what was done; for a link that cannot be used it says so and offers nothing.
 */
import { LINK_FLOWS } from '../account/link-cookie';
import type { NoticeCode } from '../account/route';
import { RECIPIENT_COPY as COPY } from '../copy/agency-reports';
import { NOTICE_LINES } from '../copy/notices';
import { RECIPIENT_LINKS, type RecipientLink } from './schedules';
import type { RecipientLinkView } from './schedules-store';

export interface RecipientLinkPageView {
  state: 'link' | 'done' | 'gone';
  title: string;
  lines: string[];
  /** The form's route and its button: it posts no field. Null once done, and for a dead link. */
  act: { action: string; label: string } | null;
}

/**
 * `link` is what the cookie's token opens, or null; `notice` is the page's `?notice=`, set by the
 * form's answer. A notice of the other page's, and a link of the other kind, are not this page's.
 */
export function recipientLinkView(
  kind: RecipientLink,
  link: RecipientLinkView | null,
  notice: NoticeCode | null,
): RecipientLinkPageView {
  const { flow, done } = RECIPIENT_LINKS[kind];
  if (notice === done) {
    return { state: 'done', title: COPY[kind].done, lines: [NOTICE_LINES[done](null)], act: null };
  }
  if (link?.kind !== kind) {
    return { state: 'gone', title: COPY.gone.title, lines: [COPY.gone.line], act: null };
  }
  return {
    state: 'link',
    title: COPY[kind].title,
    lines: COPY[kind].lines(link.accountName ?? COPY.someone, link.host),
    act: { action: LINK_FLOWS[flow].api, label: COPY[kind].button },
  };
}
